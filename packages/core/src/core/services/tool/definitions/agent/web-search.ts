import { tool } from "ai";
import { z } from "zod";
import Exa from "exa-js";

import { rationale, defineTool } from "../../ztypes";

const inputSchema = z.object({
  query: z.string().describe("What to search the web for"),
  rationale,
});

type Input = z.infer<typeof inputSchema>;

const NUM_RESULTS = 10;
/** Per-result snippet cap, so a search turn doesn't flood the agent's context. */
const MAX_TEXT_CHARS = 12000;

/** JS/DOM idioms that mark a line as page chrome rather than article text. */
const CODE_LINE =
  /(function\s*\(|document\.|window\.|getElementById|addEventListener|=>|\.onclick|<\/?[a-z]|[{}])/i;

/** Short navigation / boilerplate fragments that carry no real content. */
const BOILERPLATE =
  /^(menu|close|share|copy link|saved items.*|back to top|skip to.*content|sign ?in|log ?in|subscribe|newsletter|cookies?|accept all|privacy policy|terms.*|follow us|all rights reserved|home|search|next|previous|read more)\b/i;

/** Control and zero-width characters that survive scraping. */
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\uFEFF]/g;

/**
 * Strip page chrome (nav menus, social-share widgets, inline scripts, cookie
 * banners) from a fetched page so the agent reasons over real article text, not
 * boilerplate. Conservative on purpose: it drops lines that clearly look like
 * markup/JS or short navigation fragments, and leaves prose untouched.
 */
function cleanPageText(raw: string): string {
  if (!raw) return "";

  const lines = raw
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());

  const kept: string[] = [];
  let lastBlank = false;

  for (const line of lines) {
    if (line === "") {
      // Collapse runs of blank lines into a single separator.
      if (!lastBlank && kept.length > 0) {
        kept.push("");
        lastBlank = true;
      }
      continue;
    }
    lastBlank = false;

    if (CODE_LINE.test(line)) continue;
    if (line.length < 40 && BOILERPLATE.test(line)) continue;
    // Drop very short symbol/menu fragments with no real words.
    if (line.length <= 2) continue;

    kept.push(line);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

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
      "Search the web for up-to-date information. Returns the top results, each with a title, url, and a cleaned text snippet (page chrome and scripts stripped) from the page.",
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
        // Strip nav/script boilerplate before capping, so the budget is spent on
        // real article text rather than menus and inline JS.
        snippet: cleanPageText(r.text ?? "").slice(0, MAX_TEXT_CHARS),
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
