import type { Agent as AgentConfig } from "./schema";
import type { EventItem } from "../event-bus/schema";
import type { EventBus } from "../event-bus";
import type {
  MemoryService,
  Reasoning,
  ReasoningContext,
  ToolRegistry,
  ToolResult,
} from "./services";

/** Shared collaborators injected into every agent (see services.ts). */
export interface AgentServices {
  memory: MemoryService;
  tools: ToolRegistry;
}

/**
 * ONE agent for the whole org. CEO ≠ head ≠ manager ≠ worker ≠ reviewer is
 * decided by config.tools (the grant) + the composed prompt — NOT by the class.
 * There is no AgentAction union and no per-role subclass: the agent only ever
 * calls tools, and which tools it MAY call is its grant. escalate / delegate /
 * spawn / run_code / submit_review are ALL just tools, resolved by the registry.
 *
 * The ONLY axis this abstract base leaves open is HOW the agent reasons. The
 * lifecycle — subscribe to the bus, perceive → reason → observe, record, handle
 * errors — lives here and is fixed. Subclasses supply {@link reason} (e.g. an
 * LLM call). Services are injected, never new'd per agent.
 */
export abstract class BaseAgent {
  readonly config: AgentConfig;

  protected readonly memory: MemoryService;
  protected readonly tools: ToolRegistry;

  private readonly bus: EventBus;
  private subscribed = false;

  constructor(config: AgentConfig, bus: EventBus, services: AgentServices) {
    this.config = config;
    this.bus = bus;
    this.memory = services.memory;
    this.tools = services.tools;
  }

  get id() {
    return this.config.id;
  }

  get status() {
    return this.config.status;
  }

  /** Begin receiving events. The bus pushes anything targeting this agent's id. */
  start(): void {
    if (this.subscribed) return;
    this.bus.subscribe(this.config.id, (event) => this.dispatch(event));
    this.subscribed = true;
  }

  /** Stop receiving events (e.g. on suspension or termination). */
  stop(): void {
    if (!this.subscribed) return;
    this.bus.unsubscribe(this.config.id);
    this.subscribed = false;
  }

  // ─────────>> the one open hook: how the agent reasons <<──────────
  protected abstract reason(ctx: ReasoningContext): Promise<Reasoning>;

  private async dispatch(event: EventItem): Promise<void> {
    // A suspended agent may still be subscribed during a status flip; drop.
    if (this.config.status !== "active") return;
    try {
      await this.handle(event);
    } catch (err) {
      await this.onError(event, err);
    }
  }

  // ─────────>> perceive → reason → observe <<──────────
  private async handle(event: EventItem): Promise<void> {
    const results: ToolResult[] = [];

    const ctx = await this.memory.assembleContext(this.config, event, results);
    const reasoning = await this.reason(ctx);

    for (const call of reasoning.toolCalls) {
      const output = await this.tools.execute(this.config, call);
      results.push({ tool: call.tool, output });
    }

    await this.memory.recordTurn(
      this.config.id,
      event,
      reasoning.toolCalls,
      results,
    );
  }

  private async onError(event: EventItem, err: unknown): Promise<void> {
    // The agent never talks to anyone directly — even failure goes out as a
    // tool call, which the registry routes (escalate → reportsTo).
    await this.tools.execute(this.config, {
      tool: "escalate",
      args: {
        reason: `error handling ${event.type} (${event.id}): ${String(err)}`,
      },
    });
  }
}
