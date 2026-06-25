import { generateText, hasToolCall, ToolSet, type ModelMessage } from "ai";

import type { Agent, AgentId, Event } from "../schema";
import type { EventBus, Mailbox } from "../event-bus";
import type { MemoryService } from "../services/memory";
import type { PromptService } from "../services/prompt";
import type { ToolService } from "../services/tool";
import type { TaskRepository } from "../../repositories";
import { DockerSandbox } from "../sandbox";
import { withModel } from "../utils";
import { ToolDefinition } from "../services/tool/definitions";
import { google } from "@ai-sdk/google";

/**
 * The one agent in the system.
 *
 * Every agent — executive, head, manager, worker — is a BaseAgent: it owns a
 * mailbox, blocks on the next event, reasons once with its granted tools, and
 * lets those tools' `execute` carry the effect (publish an org event, or drive
 * a sandbox).
 *
 * Every agent runs the same open-ended act→observe loop: it must call a tool
 * each step (tools are the only way to communicate) and keeps acting until it
 * explicitly yields with wait_until_response or escalate_blocker.
 *
 * The *only* thing that distinguishes an engineering worker is two facts wired
 * here behind a single `if`: it owns a Docker sandbox, and the tool service
 * therefore hands it filesystem/bash tools. There is no separate "engineering
 * worker" class — it is all this.
 */
export class BaseAgent {
  private running = false;
  private prepared = false;
  private readonly mailbox: Mailbox;
  private readonly sandbox?: DockerSandbox;

  constructor(
    private readonly config: Agent,
    private readonly bus: EventBus,
    private readonly memory: MemoryService,
    private readonly tools: ToolService,
    private readonly prompts: PromptService,
    private readonly tasks: TaskRepository,
  ) {
    this.mailbox = this.bus.subscribe(config.id);

    // The single `if`: an engineering worker — and only that — gets a sandbox,
    // named after the agent so the container/branch is stable across runs.
    if (config.role === "worker" && config.department === "engineering") {
      this.sandbox = new DockerSandbox({ name: config.id });
    }
  }

  get id(): AgentId {
    return this.config.id;
  }

  start(): void {
    console.log("Agent starting", this.config.id);
    if (this.running) return;
    console.log("Agent started", this.config.id);
    this.running = true;
    void this.run();
  }

  stop(): void {
    this.running = false;
    this.bus.unsubscribe(this.config.id);
    void this.sandbox?.stop();
  }

  private async run(): Promise<void> {
    while (this.running) {
      const event = await this.mailbox.takeNext();
      console.log("Agent ", `${this.config.id} received event: `, event);

      if (this.config.status !== "active") continue;

      try {
        await this.handle(event);
      } catch (err) {
        await this.onError(event, err);
      }
    }
  }

  private async handle(event: Event): Promise<void> {
    if (this.sandbox) await this.prepareSandbox();

    const context = await this.memory.assembleContext(this.config, event);
    const newMessage = await this.prepareMessage(event);
    const messages = [...context, newMessage];

    console.log(
      `[Agent:${this.config.id}] Handling event\n`,
      JSON.stringify(
        {
          event,
          messages,
        },
        null,
        2,
      ),
    );
    const responseMessages = await this.reason(messages);

    await this.memory.recordTurn(this.config, [
      newMessage,
      ...responseMessages,
    ]);
  }

  private async reason(messages: ModelMessage[]): Promise<ModelMessage[]> {
    try {
      // Pick a rate-limited key from the pool, run under the concurrency cap,
      // and let the SDK retry transient failures (429 rate limits, 5xx) with
      // exponential backoff instead of surfacing them to the agent loop.
      const result = await withModel(
        this.config.department,
        this.config.role,
        (model) =>
          generateText({
            model,
            system: this.prompts.buildSystemPrompt(this.config),
            messages,
            maxRetries: 5,
            tools: this.tools.getTools(this.config, this.sandbox),
            // Tools are the ONLY channel an agent communicates through, so every
            // step must call one — `toolChoice: "required"`, for every agent. The
            // agent runs an open-ended act→observe loop: it acts, observes the tool
            // result, acts again, for as many decisive actions as the event needs
            // (e.g. delegate to all subordinates, or search → reason → report).
            // There is no per-event step cap; the loop ends only when the agent
            // explicitly YIELDS — it parks itself with wait_until_response (work
            // submitted / nothing to do but wait) or hands the problem up with
            // escalate_blocker. Without an explicit yield the agent would otherwise
            // finish one action and block forever on an empty mailbox, deadlocking
            // the org.
            toolChoice: "required",
            stopWhen: [
              hasToolCall("wait_until_response"),
              hasToolCall("escalate_blocker"),
              hasToolCall("request_review"),
            ],
          }),
      );
      return result.response.messages;
    } catch (error) {
      console.error("generateText failed", error);
      throw error;
    }
  }

  private async prepareMessage(event: Event): Promise<ModelMessage> {
    let body: string;

    if (event.topic === "agent" && event.type === "task_delegation_request") {
      const task = await this.tasks.get(event.body.taskId);
      body = task
        ? [
            `You have been assigned task ${task.id}: "${task.title}".`,
            "",
            task.description,
            "",
            "Acceptance criteria:",
            task.acceptanceCriteria.map((c) => `- ${c}`).join("\n") ||
              "- (none specified)",
          ].join("\n")
        : `You were delegated task ${event.body.taskId}, but it could not be found.`;
    } else {
      const payload = (event as { body?: unknown }).body ?? {};
      body = `From ${event.source}:${JSON.stringify(payload, null, 2)}`;
    }

    const correlation = event.correlationId
      ? ` (in reply to your command ${event.correlationId})`
      : "";

    return {
      role: "user",
      content: `[${event.topic}/${event.type}]${correlation}\n${body}`,
    };
  }

  private async prepareSandbox(): Promise<void> {
    if (!this.sandbox) return;

    // Ensure the container is running on EVERY turn — start() is idempotent.
    // The Auditor pauses the worker's container after a review, so gating this
    // behind `prepared` would leave a stopped sandbox that rework can't exec
    // into after a changes_requested verdict.
    await this.sandbox.start();

    if (this.prepared) return;

    const branch = this.sandbox.name;

    const inRepo =
      (await this.sandbox.exec("git rev-parse --is-inside-work-tree"))
        .exitCode === 0;
    if (!inRepo) {
      await this.sandbox.exec("git init -q");
    }

    await this.sandbox.exec(
      `git config user.email "${branch}@agents.local" && git config user.name "${branch}"`,
    );
    await this.sandbox.exec(
      `git checkout "${branch}" 2>/dev/null || git checkout -b "${branch}"`,
    );

    this.prepared = true;
  }

  private async onError(event: Event, err: unknown): Promise<void> {
    await this.tools.execute(this.config, {
      toolCallId: `${this.config.id}_error`,
      type: "tool-call",
      toolName: "escalate_blocker",
      input: {
        reason: `error handling ${event.type} (${event.id}): ${String(err)}`,
        blockedTaskId: null,
        rationale: "Automatic escalation after an unhandled error.",
      },
    });
  }
}
