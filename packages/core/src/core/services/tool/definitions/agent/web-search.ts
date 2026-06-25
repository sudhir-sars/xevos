import { tool } from "ai";
import { z } from "zod";
import Exa from "exa-js";

import { rationale, defineTool } from "../../ztypes";

const inputSchema = z.object({
  query: z.string().describe("What to search the web for"),
  rationale,
});

type Input = z.infer<typeof inputSchema>;

const NUM_RESULTS = 5;
/** Per-result snippet cap, so a search turn doesn't flood the agent's context. */
const MAX_TEXT_CHARS = 1200;

// Built lazily so a missing key surfaces as a clean tool error rather than
// crashing at module load.
let client: Exa | undefined;

function getClient(): Exa | null {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Exa(apiKey);
  return client;
}

export const webSearch = defineTool({
  name: "web_search",
  tool: tool({
    description:
      "Search the web for up-to-date information. Returns the top results, each with a title, url, and a text snippet from the page.",
    inputSchema,
  }),

  handler: async (_ctx, args: Input) => {
    const exa = getClient();

    if (!exa) {
      return {
        success: false,
        error:
          "web search is unavailable: EXA_API_KEY is not set in the environment",
      };
    }

    try {
      const { results } = await exa.searchAndContents(args.query, {
        type: "auto",
        numResults: NUM_RESULTS,
        text: { maxCharacters: MAX_TEXT_CHARS },
      });

      const mapped = results.map((r) => ({
        title: r.title ?? "(untitled)",
        url: r.url,
        publishedDate: r.publishedDate ?? null,
        snippet: (r.text ?? "").trim().slice(0, MAX_TEXT_CHARS),
      }));

      return {
        success: true,
        result: {
          query: args.query,
          results: mapped,
          note:
            mapped.length === 0
              ? "No results found for this query."
              : undefined,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `web search error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  },
});
