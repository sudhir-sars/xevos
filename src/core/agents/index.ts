import type { Agent, Event } from "../schema";
import type { EventBus, Mailbox } from "../event-bus";
import { MemoryService, PromptService } from "../services";
import type { ToolRegistry, ToolResult } from "./services";
import { generateText, ModelMessage } from "ai";
import { getModel } from "../utils";

export class BaseAgent {
  private running = false;
  private readonly mailBox: Mailbox;

  constructor(
    private readonly config: Agent,
    private readonly bus: EventBus,
    private readonly memory: MemoryService,
    private readonly tools: ToolRegistry,
    private readonly prompts: PromptService,
  ) {
    this.mailBox = this.bus.subscribe(config.id);
  }

  get id() {
    return this.config.id;
  }

  get status() {
    return this.config.status;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    void this.run();
  }

  stop(): void {
    this.running = false;

    this.bus.unsubscribe(this.config.id);
  }

  private async run(): Promise<void> {
    while (this.running) {
      const event = await this.mailBox.takeNext();

      if (this.config.status !== "active") {
        continue;
      }

      try {
        await this.handle(event);
      } catch (err) {
        await this.onError(event, err);
      }
    }
  }

  protected async reason(messages: ModelMessage[]): Promise<ModelMessage[]> {
    const result = await generateText({
      model: getModel(this.config.department, this.config.role),
      system: this.prompts.buildSystemPrompt(this.config),
      messages,
      toolChoice: "required",
      tools: this.tools.getTools(this.config.id),
    });

    const responseMessages = result.response.messages;
    return responseMessages;
  }
  private async handle(event: Event): Promise<void> {
    const results: ToolResult[] = [];

    const ctx = await this.memory.assembleContext(this.config, event);

    const responseMessages = await this.reason(ctx);

    for (const message of responseMessages) {
      if (message.role !== "assistant") continue;

      const content = Array.isArray(message.content) ? message.content : [];

      for (const part of content) {
        if (part.type !== "tool-call") continue;

        const output = await this.tools.execute(this.config, part);

        results.push({
          tool: part.toolName,
          output,
        });
      }
    }

    await this.memory.recordTurn(this.config, responseMessages);
  }

  private async onError(event: Event, err: unknown): Promise<void> {
    await this.tools.execute(this.config, {
      toolCallId: `${Date.now()}`,
      type: "tool-call",
      toolName: "escalate",
      input: {
        reason: `error handling ${event.type} (${event.id}): ${String(err)}`,
      },
    });
  }
}
