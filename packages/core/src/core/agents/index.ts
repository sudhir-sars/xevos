import { generateText, stepCountIs, ToolSet, type ModelMessage } from "ai";

import type { Agent, AgentId, Event } from "../schema";
import type { EventBus, Mailbox } from "../event-bus";
import type { MemoryService } from "../services/memory";
import type { PromptService } from "../services/prompt";
import type { ToolService } from "../services/tool";
import type { TaskRepository } from "../../repositories";
import { DockerSandbox } from "../sandbox";
import { getModel } from "../utils";
import { ToolDefinition } from "../services/tool/definitions";

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
 * no separate "engineering worker" class — it is all this.
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
      const result = await generateText({
        model: getModel(this.config.department, this.config.role),
        system: this.prompts.buildSystemPrompt(this.config),
        messages,
        tools: this.tools.getTools(this.config, this.sandbox),
        toolChoice: "required",
        // A sandbox-backed worker iterates (reason→act→observe) until done; every
        // other agent takes one decisive action per event.
        stopWhen: stepCountIs(this.sandbox ? WORKER_MAX_STEPS : 1),
      });
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
