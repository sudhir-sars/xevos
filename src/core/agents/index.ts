import { generateText, stepCountIs, type ModelMessage } from "ai";

import type { Agent, AgentId, Event } from "../schema";
import type { EventBus, Mailbox } from "../event-bus";
import type { MemoryService } from "../services/memory";
import type { PromptService } from "../services/prompt";
import type { ToolService } from "../services/tool";
import type { TaskRepository } from "../../repositories";
import { DockerSandbox } from "../sandbox";
import { getModel } from "../utils";

/** How many act→observe steps a sandbox-backed worker may take per event. */
const WORKER_MAX_STEPS = 30;

/**
 * The one agent in the system.
 *
 * Every agent — executive, head, manager, worker — is a BaseAgent: it owns a
 * mailbox, blocks on the next event, reasons once with its granted tools, and
 * lets those tools' `execute` carry the effect (publish an org event, or drive
 * a sandbox).
 *
 * The *only* thing that distinguishes an engineering worker is two facts wired
 * here behind a single `if`: it owns a Docker sandbox, and the tool service
 * therefore hands it filesystem/bash tools. With a sandbox it runs a multi-step
 * coding loop; without one it takes a single decisive turn per event. There is
 * no separate "engineering agent" or "worker" class — it is all this.
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
    if (this.running) return;
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
    const trigger = await this.renderEvent(event);
    const messages = [...context, trigger];

    const responseMessages = await this.reason(messages);

    // Persist the prompting event alongside the response so the next turn has
    // the full conversation, not orphaned tool calls.
    await this.memory.recordTurn(this.config, [trigger, ...responseMessages]);
  }

  private async reason(messages: ModelMessage[]): Promise<ModelMessage[]> {
    const isWorker = this.sandbox != null;

    const result = await generateText({
      model: getModel(this.config.department, this.config.role),
      system: this.prompts.buildSystemPrompt(this.config),
      messages,
      tools: this.tools.getTools(this.config, this.sandbox),
      // Coordinators must act every turn (one decisive turn per event). A worker
      // runs free until it finishes the task with a plain-text summary.
      toolChoice: "required",
      stopWhen: stepCountIs(isWorker ? WORKER_MAX_STEPS : 1),
    });

    return result.response.messages;
  }

  /**
   * Render the triggering event into a user message the model can act on.
   * Task delegations are expanded with the full task; everything else is shown
   * as its readable body.
   */
  private async renderEvent(event: Event): Promise<ModelMessage> {
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
      body = `From ${event.source}:\n${JSON.stringify(payload, null, 2)}`;
    }

    return { role: "user", content: `[${event.topic}/${event.type}]\n${body}` };
  }

  /**
   * One-time, deterministic sandbox setup for an engineering worker: start the
   * container and put it on its own branch (named after the agent) before any
   * gated git tool runs. Done in code — not left to the model — so branch
   * isolation can never be skipped. Idempotent.
   */
  private async prepareSandbox(): Promise<void> {
    if (!this.sandbox || this.prepared) return;

    await this.sandbox.start();
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
