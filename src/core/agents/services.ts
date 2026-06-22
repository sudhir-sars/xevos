import { z } from "zod";
import type { ModelMessage } from "ai";

import type { Agent, AgentId } from "./schema";
import type { EventItem } from "../event-bus/schema";

/* ============================================================================
 * AGENT SERVICE CONTRACTS
 *
 * BaseAgent is pure orchestration: it never news up its collaborators. It
 * depends only on the interfaces below, injected at construction. This keeps
 * the agent testable (swap in fakes) and lets the tool registry / memory store
 * evolve independently of the perceive→reason→observe loop.
 * ========================================================================== */

/** A single tool invocation the agent decided to make this turn. */
export type ToolCall = { tool: string; args: Record<string, unknown> };

/** The outcome of executing a {@link ToolCall}, fed back into memory. */
export type ToolResult = { tool: string; output: unknown };

/**
 * The structured decision the model returns each turn: the tools to invoke and
 * whether the agent considers the triggering event handled.
 */
export const reasoningSchema = z.object({
  toolCalls: z.array(
    z.object({
      tool: z.string(),
      args: z.record(z.string(), z.unknown()),
    }),
  ),
  done: z.boolean(),
});
export type Reasoning = z.infer<typeof reasoningSchema>;

/**
 * Everything the model needs for one turn, assembled by the MemoryService.
 * The agent is stateless between turns — this context IS its working memory.
 */
export interface ReasoningContext {
  messages: ModelMessage[];
}

/** Resolves and runs tools against an agent's grant (config.tools). */
export interface ToolRegistry {
  execute(config: Agent, call: ToolCall): Promise<unknown>;
}

/** Owns per-agent working memory and the long-term warehouse. */
export interface MemoryService {
  assembleContext(
    config: Agent,
    event: EventItem,
    results: ToolResult[],
  ): Promise<ReasoningContext>;

  recordTurn(
    agentId: AgentId,
    event: EventItem,
    toolCalls: ToolCall[],
    results: ToolResult[],
  ): Promise<void>;
}
