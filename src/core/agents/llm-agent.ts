import { generateObject } from "ai";

import { BaseAgent } from "./agent";
import { composePrompt } from "./prompts";
import {
  reasoningSchema,
  type Reasoning,
  type ReasoningContext,
} from "./services";

const MODEL = "google/gemini-2.5-flash";

/**
 * The concrete agent: it reasons by asking an LLM for the next batch of tool
 * calls. The system prompt is composed from the agent's role × department ×
 * objective (see prompts.ts); the turn's working memory arrives as messages.
 * Everything else — the lifecycle, tool execution, error escalation — is the
 * abstract {@link BaseAgent}.
 */
export class LlmAgent extends BaseAgent {
  protected async reason(ctx: ReasoningContext): Promise<Reasoning> {
    const { object } = await generateObject({
      model: MODEL,
      schema: reasoningSchema,
      system: composePrompt(this.config),
      messages: ctx.messages,
    });
    return object;
  }
}
