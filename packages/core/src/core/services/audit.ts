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
  AgentId,
  EndpointId,
  Event,
  ReviewPresentationRequestEvent,
  ReviewPresentationResponseEvent,
  ReviewVerdict,
  ServiceId,
  Task,
} from "../schema";
import type {
  AgentMemoryRepository,
  AgentRepository,
  TaskRepository,
} from "../../repositories";

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

/** Per-tool-result clip so one huge result (e.g. a full web page) can't flood the review prompt. */
const MAX_RESULT_CHARS = 3000;
/** Overall cap on the rendered action log; the most RECENT actions are kept. */
const MAX_ACTION_LOG_CHARS = 24000;

/** Poll the submitter's memory until its just-submitted turn lands, or give up. */
const ACTION_LOG_POLL_ATTEMPTS = 6;
const ACTION_LOG_POLL_MS = 100;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function clipResult(value: unknown): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  text = text ?? "";
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}… [truncated]`
    : text;
}

/**
 * Render the submitter's actual tool-call history into a flat log: every tool it
 * called, with arguments, and the real result that came back. This is GROUND
 * TRUTH about what the agent did — a research worker's real web_search queries
 * and the sources it actually retrieved — so the Auditor can check the report's
 * claims against what happened, not just trust the prose. Kept to the most
 * recent actions if the history is long.
 */
function renderActionLog(messages: readonly ModelMessage[]): string {
  const lines: string[] = [];

  for (const message of messages) {
    if (typeof message.content === "string") continue;

    for (const part of message.content) {
      switch (part.type) {
        case "tool-call":
          lines.push(`CALL ${part.toolName}(${clipResult(part.input)})`);
          break;
        case "tool-result":
          lines.push(`  → RESULT ${part.toolName}: ${clipResult(part.output)}`);
          break;
        default:
          break;
      }
    }
  }

  const log = lines.join("\n");
  return log.length > MAX_ACTION_LOG_CHARS
    ? `… [earlier actions truncated]\n${log.slice(-MAX_ACTION_LOG_CHARS)}`
    : log;
}

/** True once the submitter's memory contains a request_review tool-call (its submission turn). */
function hasSubmissionTurn(messages: readonly ModelMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some(
        (p) => p.type === "tool-call" && p.toolName === "request_review",
      ),
  );
}

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
    private readonly agents: AgentRepository,
    private readonly agentMemory: AgentMemoryRepository,
  ) {
    this.mailbox = bus.subscribe(AUDITOR_ID);
  }

  /**
   * Pull the submitter's raw tool-call history. The submission turn is recorded
   * by the submitter AFTER its request_review fires, so there is a brief race
   * with this review starting — poll the (shared, in-memory) store until that
   * turn lands rather than reviewing against a stale log.
   */
  private async loadActionLog(submitter: AgentId): Promise<string> {
    let messages: readonly ModelMessage[] = [];

    for (let attempt = 0; attempt < ACTION_LOG_POLL_ATTEMPTS; attempt++) {
      const memory = await this.agentMemory.get(submitter);
      messages = memory?.messages ?? [];
      if (hasSubmissionTurn(messages)) break;
      await sleep(ACTION_LOG_POLL_MS);
    }

    return renderActionLog(messages);
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

    // The submitter's REAL tool-call history: what it actually did, not just the
    // prose it pasted. For non-coding work (e.g. research) this is the only
    // ground truth there is — the searches it ran and the sources it retrieved.
    const actionLog = await this.loadActionLog(submitter as AgentId);

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

    // Pull ground truth straight from the worker's container, so the verdict is
    // judged against what is REALLY there — not the (possibly fabricated) text
    // evidence. If a coding worker left the workspace empty, it never actually
    // built anything: fail immediately, no LLM review needed.
    let groundTruth = "";
    let emptyWorkspace = false;
    if (sandbox) {
      try {
        const probe = await sandbox.exec(
          "find . -type f -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | wc -l; echo '===TREE==='; ls -la; echo '===GIT==='; git log --oneline -10 2>/dev/null || echo '(no commits)'",
        );
        groundTruth = probe.stdout;
        const fileCount = Number.parseInt(
          probe.stdout.split("\n")[0]?.trim() ?? "0",
          10,
        );
        emptyWorkspace = Number.isFinite(fileCount) && fileCount === 0;
      } catch (error) {
        console.error(
          `[auditor] could not probe workspace for ${submitter}`,
          error,
        );
      }
    }

    const verdict =
      coding && emptyWorkspace
        ? {
            verdict: "changes_requested" as ReviewVerdict,
            notes:
              "The workspace is empty — no source files were produced. The submitted evidence cannot be trusted over an empty sandbox: the task was not actually built. Do the real work in the sandbox, commit it, and resubmit.",
          }
        : await this.assess(event, task, sandbox, coding, groundTruth, actionLog);

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

    // The Auditor renders the binding verdict but does NOT change task state.
    // Marking a task completed is the MANAGER's authority alone — never the
    // Auditor's and never the worker's. So the verdict is delivered to the
    // task's manager (the assignee's reportsTo), who completes it on PASS or
    // relays the findings to the worker on CHANGES. (With no task we fall back
    // to replying to the submitter.)
    let recipient: EndpointId = submitter;
    if (task?.assignedTo) {
      try {
        recipient = this.agents.get(task.assignedTo).reportsTo;
      } catch (error) {
        console.error(
          `[auditor] could not resolve manager for ${task.assignedTo}`,
          error,
        );
      }
    }

    const response: Omit<ReviewPresentationResponseEvent, "id"> = {
      source: AUDITOR_ID,
      target: recipient,
      topic: "agent",
      type: "review_presentation_response",
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
    groundTruth: string,
    actionLog: string,
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
      {
        role: "user",
        content: this.buildReviewPrompt(
          event,
          task,
          coding,
          groundTruth,
          actionLog,
        ),
      },
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
    groundTruth: string,
    actionLog: string,
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

    // The submitter's REAL tool-call history — what it actually did. This is
    // ground truth: trust it over the summary. If the report claims sources,
    // results, or commands that do NOT appear here, the evidence is fabricated.
    lines.push(
      "",
      "ACTION LOG — the submitter's actual tool calls and the real results they returned (GROUND TRUTH; trust this over the summary):",
      "```",
      actionLog.trim() ||
        "(the submitter recorded no tool calls — it produced no verifiable work)",
      "```",
      "",
      "Cross-check the submission against this log. Every claimed source, figure, or result MUST trace to a real tool result above. A claim with no backing action — e.g. cited sources that were never actually retrieved by web_search, or output never produced — is fabricated: request changes. If the task needed real work (a search, a build) and the log shows none, fail it.",
    );

    if (coding) {
      lines.push(
        "",
        "This is a CODING task. You have sandbox tools (bash, read_file, list_dir, glob, grep, …) attached to the submitter's workspace at /workspace. Inspect the code and re-run the build/tests yourself before deciding. Inspect only — do not modify their work.",
      );

      if (groundTruth.trim()) {
        lines.push(
          "",
          "Actual current state of the workspace, read directly from the container (GROUND TRUTH — trust this over the summary; if it contradicts the evidence, the evidence is fabricated):",
          "```",
          groundTruth.trim(),
          "```",
        );
      }
    }

    lines.push("", "When done, call record_verdict with your decision.");

    return lines.join("\n");
  }
}
