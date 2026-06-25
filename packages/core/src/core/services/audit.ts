// services/audit.service.ts

import {
  generateText,
  hasToolCall,
  stepCountIs,
  tool,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { z } from "zod";

import type {
  Event,
  ReviewPresentationRequestEvent,
  ReviewPresentationResponseEvent,
  ReviewVerdict,
  ServiceId,
  Task,
} from "../schema";
import type { TaskRepository } from "../../repositories";

import { type EventBus, type Mailbox } from "../event-bus";
import { DockerSandbox } from "../sandbox";
import { withModel } from "../utils";

import { codingTools } from "./tool/definitions/code";
import type { ToolContext } from "./tool/ztypes";
import { AUDITOR_PROMPT } from "../../repositories/prompt/default-prompts";

/**
 * The fixed mailbox the Auditor listens on. It is a service id, not an agent id:
 * the Auditor is not part of the org and has no place in the agent hierarchy.
 */
export const AUDITOR_ID: ServiceId = "auditor_service";

/** Backstop on the act→observe loop so a runaway review can't loop forever. */
const MAX_REVIEW_STEPS = 100;

/** ids are `${role}_${department}_${n}`; only engineering workers own sandboxes. */
function isEngineeringWorker(id: string): boolean {
  const parts = id.split("_");
  return (
    parts.length === 3 && parts[0] === "worker" && parts[1] === "engineering"
  );
}

/**
 * The Auditor: a single, standalone, STATELESS quality checker.
 *
 * It is deliberately outside the organization — not a department, not an agent
 * in the reporting tree. Only workers reach it, via request_review, which
 * publishes a review_presentation_request to AUDITOR_ID. For each request it
 * gathers everything it needs (the task + acceptance criteria, the submitted
 * evidence, and — for a coding task — the submitter's sandbox), judges quality,
 * and replies with a verdict. It keeps no memory between reviews.
 */
export class AuditService {
  private running = false;
  private readonly mailbox: Mailbox;

  constructor(
    private readonly bus: EventBus,
    private readonly tasks: TaskRepository,
  ) {
    this.mailbox = bus.subscribe(AUDITOR_ID);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.consume();
  }

  stop(): void {
    this.running = false;
    this.bus.unsubscribe(AUDITOR_ID);
  }

  private async consume(): Promise<void> {
    while (this.running) {
      const event = await this.mailbox.takeNext();
      try {
        await this.handle(event);
      } catch (error) {
        console.error("[auditor] failed to review", error);
      }
    }
  }

  private async handle(event: Event): Promise<void> {
    if (
      event.topic !== "agent" ||
      event.type !== "review_presentation_request"
    ) {
      return;
    }
    await this.review(event);
  }

  private async review(event: ReviewPresentationRequestEvent): Promise<void> {
    const submitter = event.source;
    const task = event.body.taskId
      ? await this.tasks.get(event.body.taskId)
      : null;
    const coding = isEngineeringWorker(submitter);

    // For a coding task, attach to the submitter's sandbox so quality is judged
    // against the real code, not just the pasted evidence. The container is the
    // submitter's; resume it, never create or tear it down.
    let sandbox: DockerSandbox | undefined;
    if (coding) {
      try {
        sandbox = new DockerSandbox({ name: submitter });
        await sandbox.start();
      } catch (error) {
        console.error(
          `[auditor] could not attach sandbox for ${submitter}`,
          error,
        );
        sandbox = undefined;
      }
    }

    const verdict = await this.assess(event, task, sandbox, coding);

    // Bug 3 fix: pause the sandbox after assessment — we resumed it, so we
    // should return it to a paused state. Never destroy: it belongs to the worker.
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch (error) {
        console.error(
          `[auditor] could not pause sandbox for ${submitter}`,
          error,
        );
      }
    }

    // The Auditor owns "done": a pass completes the task; changes requested
    // sends it back so the worker can rework and resubmit.
    if (task) {
      await this.tasks.update(task.id, {
        status: verdict.verdict === "approved" ? "completed" : "in_progress",
      });
    }

    // Reply straight to the worker that asked (only workers know the Auditor).
    const response: Omit<ReviewPresentationResponseEvent, "id"> = {
      source: AUDITOR_ID,
      target: submitter,
      topic: "agent",
      type: "review_presentation_response",
      correlationId: event.id,
      body: {
        summary: `${
          verdict.verdict === "approved" ? "PASS" : "CHANGES REQUESTED"
        }: ${verdict.notes}`,
        taskId: task?.id ?? null,
      },
    };
    this.bus.publish<ReviewPresentationResponseEvent>(response);
  }

  /** One stateless LLM quality assessment; returns the verdict it recorded. */
  private async assess(
    event: ReviewPresentationRequestEvent,
    task: Task | null,
    sandbox: DockerSandbox | undefined,
    coding: boolean,
  ): Promise<{ verdict: ReviewVerdict; notes: string }> {
    let captured: { verdict: ReviewVerdict; notes: string } | null = null;

    // Bug 1+2 fix: use the `tool()` helper correctly with `parameters` (not
    // `inputSchema`), and drop the bogus inner `tool({ ... })` wrapper that was
    // treating the config as a method call.
    const tools: ToolSet = {
      record_verdict: tool({
        description:
          "Record your final quality verdict. Call this exactly once, last.",
        inputSchema: z.object({
          verdict: z.enum(["approved", "changes_requested"]),
          notes: z
            .string()
            .describe(
              "Concrete, actionable findings: what passed, and what failed and why.",
            ),
        }),
        execute: async (input) => {
          captured = input as { verdict: ReviewVerdict; notes: string };
          return { success: true, result: { recorded: true } };
        },
      }),
    };

    if (sandbox) {
      for (const def of codingTools(sandbox)) {
        tools[def.name] = {
          ...def.tool,
          execute: (input: unknown) =>
            def.handler({} as ToolContext, input as never),
        } as ToolSet[string];
      }
    }

    const messages: ModelMessage[] = [
      { role: "user", content: this.buildReviewPrompt(event, task, coding) },
    ];

    await withModel("organization", "manager", (model) =>
      generateText({
        model,
        system: AUDITOR_PROMPT,
        messages,
        tools,
        maxRetries: 5,
        toolChoice: "required",
        stopWhen: [
          stepCountIs(MAX_REVIEW_STEPS),
          hasToolCall("record_verdict"),
        ],
      }),
    );

    return (
      captured ?? {
        verdict: "changes_requested",
        notes:
          "The auditor did not return a verdict within the review budget; treat as not yet approved.",
      }
    );
  }

  private buildReviewPrompt(
    event: ReviewPresentationRequestEvent,
    task: Task | null,
    coding: boolean,
  ): string {
    const lines: string[] = [
      `${event.source} has submitted work for your review${
        task ? ` on task ${task.id}: "${task.title}"` : ""
      }.`,
      "",
      "Their summary and evidence:",
      event.body.summary,
    ];

    if (task) {
      lines.push(
        "",
        "Task description:",
        task.description,
        "",
        "Acceptance criteria:",
        task.acceptanceCriteria.map((c) => `- ${c}`).join("\n") ||
          "- (none specified)",
      );
    }

    if (coding) {
      lines.push(
        "",
        "This is a CODING task. You have sandbox tools (bash, read_file, list_dir, glob, grep, …) attached to the submitter's workspace at /workspace. Inspect the code and re-run the build/tests yourself before deciding. Inspect only — do not modify their work.",
      );
    }

    lines.push("", "When done, call record_verdict with your decision.");

    return lines.join("\n");
  }
}
