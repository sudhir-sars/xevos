import type { Page } from "puppeteer-core";

import type { BrowserSession } from "../../browser/session";
import type {
  PlatformAction,
  PlatformConnector,
  PlatformWatcher,
  WatchResult,
} from "../types";
import { X } from "./selectors";

export interface PostInput {
  text: string;
}
export interface ReplyInput {
  /** Full tweet URL or status id to reply to. */
  target: string;
  text: string;
}
export interface PostResult {
  posted: boolean;
  url: string | null;
}

export interface Mention {
  id: string; // status id (snowflake; monotonic)
  author: string; // @handle
  text: string;
  url: string;
}

/** snowflake ids are monotonic; compare as BigInt so "newer than cursor" is exact. */
function isNewer(id: string, cursor: string | null): boolean {
  if (!cursor) return true;
  try {
    return BigInt(id) > BigInt(cursor);
  } catch {
    return false;
  }
}

function statusUrl(target: string): string {
  if (/^https?:\/\//.test(target)) return target;
  if (/^\d+$/.test(target)) return `${X.base}/i/web/status/${target}`;
  return target;
}

/**
 * Twitter/X automation through Obscura — the wrapper around the API we won't pay
 * for and the webhooks x.com won't give us.
 *
 * NOTE: every method drives the live x.com UI through a logged-in session, so
 * the selectors (see selectors.ts) are brittle and MUST be validated against a
 * real session; x.com changes its DOM often. All of this requires a captured
 * session for `account` (see SessionStore) — without it the pages hit the login
 * wall and the methods throw a clear "logged out" error.
 */
export class TwitterConnector implements PlatformConnector {
  readonly id = "twitter";

  constructor(private readonly session: BrowserSession) {}

  private async assertLoggedIn(page: Page): Promise<void> {
    const gate = await page.$(X.loginGate);
    if (gate) {
      throw new Error(
        "twitter session is logged out — capture a fresh session for this account",
      );
    }
  }

  async post(input: PostInput): Promise<PostResult> {
    return this.session.withPage(async (page) => {
      await page.goto(X.composeUrl, { waitUntil: "domcontentloaded" });
      await this.assertLoggedIn(page);

      await page.waitForSelector(X.tweetEditor);
      await page.click(X.tweetEditor);
      await page.type(X.tweetEditor, input.text, { delay: 25 });

      await page.waitForSelector(`${X.tweetButton}:not([aria-disabled="true"])`);
      await page.click(X.tweetButton);

      // The composer closes / clears on success.
      await page
        .waitForSelector(X.tweetEditor, { hidden: true, timeout: 15_000 })
        .catch(() => {});

      return { posted: true, url: null };
    });
  }

  async reply(input: ReplyInput): Promise<PostResult> {
    return this.session.withPage(async (page) => {
      await page.goto(statusUrl(input.target), { waitUntil: "domcontentloaded" });
      await this.assertLoggedIn(page);

      await page.waitForSelector(X.replyButton);
      await page.click(X.replyButton);

      await page.waitForSelector(X.tweetEditor);
      await page.type(X.tweetEditor, input.text, { delay: 25 });

      await page.waitForSelector(`${X.tweetButton}:not([aria-disabled="true"])`);
      await page.click(X.tweetButton);

      return { posted: true, url: statusUrl(input.target) };
    });
  }

  /** Scrape the mentions timeline; returns mentions newer than `cursor`. */
  async pollMentions(cursor: string | null): Promise<WatchResult<Mention>> {
    return this.session.withPage(async (page) => {
      await page.goto(X.mentionsUrl, { waitUntil: "domcontentloaded" });
      await this.assertLoggedIn(page);
      await page.waitForSelector(X.tweetArticle, { timeout: 15_000 }).catch(() => {});

      const scraped = await page.$$eval(
        X.tweetArticle,
        (articles, sel) => {
          return articles.map((a) => {
            const link = a.querySelector<HTMLAnchorElement>(sel.statusLink);
            const href = link?.getAttribute("href") ?? "";
            const handle = a
              .querySelector<HTMLAnchorElement>('a[href^="/"][role="link"]')
              ?.getAttribute("href")
              ?.replace(/^\//, "@")
              .split("/")[0];
            const text =
              a.querySelector('[data-testid="tweetText"]')?.textContent ?? "";
            return { href, author: handle ?? "", text };
          });
        },
        { statusLink: X.statusLink },
      );

      const all: Mention[] = [];
      for (const row of scraped) {
        const m = row.href.match(/\/status\/(\d+)/);
        if (!m) continue;
        all.push({
          id: m[1],
          author: row.author,
          text: row.text,
          url: `${X.base}${row.href}`,
        });
      }

      const fresh = all
        .filter((m) => isNewer(m.id, cursor))
        .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

      const nextCursor =
        all.reduce<string | null>(
          (max, m) => (max && BigInt(max) >= BigInt(m.id) ? max : m.id),
          cursor,
        ) ?? cursor;

      return { items: fresh, cursor: nextCursor };
    });
  }

  // ---- PlatformConnector surface (for the host to wrap into tools/watchers) ----

  get actions(): readonly PlatformAction[] {
    return [
      {
        name: "twitter_post",
        description: "Publish a tweet from the connected account.",
        run: (input) => this.post(input as PostInput),
      },
      {
        name: "twitter_reply",
        description: "Reply to a tweet (by URL or status id).",
        run: (input) => this.reply(input as ReplyInput),
      },
    ];
  }

  get watchers(): readonly PlatformWatcher[] {
    return [
      {
        name: "twitter_mentions",
        description:
          "Synthetic webhook: new mentions of the connected account since the last poll.",
        poll: (cursor) => this.pollMentions(cursor),
      },
    ];
  }
}
