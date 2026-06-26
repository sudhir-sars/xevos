import type { Page } from "puppeteer-core";

import type { BrowserSession } from "../../browser/session";
import { waitForLogin } from "../../browser/login";
import type { SessionHealth } from "../../watch/health";
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

export interface DMInput {
  /** Recipient handle (without @). */
  to: string;
  text: string;
}

export interface TargetInput {
  /** Full tweet URL or status id. */
  target: string;
}
export interface QuoteInput {
  target: string;
  text: string;
}
export interface FollowInput {
  /** Handle to follow (without @). */
  handle: string;
}

export interface DMThread {
  id: string;
  preview: string;
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

  get account(): string {
    return this.session.account;
  }

  private async assertLoggedIn(page: Page): Promise<void> {
    const gate = await page.$(X.loginGate);
    if (gate) {
      throw new Error(
        "twitter session is logged out — capture a fresh session for this account",
      );
    }
  }

  /**
   * One-time interactive capture: opens the login flow and waits until you've
   * logged in by hand (solving any CAPTCHA/2FA once); the session is then
   * persisted and reused. Requires a visible browser (Obscura non-headless).
   * For a hands-off bootstrap, prefer importCookies() from your own browser.
   */
  async captureLogin(timeoutMs?: number): Promise<void> {
    await waitForLogin(this.session, {
      loginUrl: X.loginUrl,
      isLoggedIn: async (page) => (await page.$(X.loggedInSignal)) !== null,
      timeoutMs,
    });
  }

  /** Session health check — drives the auto-escalate-on-expiry watcher. */
  async health(): Promise<SessionHealth> {
    const base = {
      platform: this.id,
      account: this.session.account,
      checkedAt: Date.now(),
    };
    try {
      const loggedIn = await this.session.withPage(async (page) => {
        await page.goto(`${X.base}/home`, { waitUntil: "domcontentloaded" });
        return (await page.$(X.loggedInSignal)) !== null;
      });
      return { ...base, loggedIn };
    } catch (error) {
      return { ...base, loggedIn: false, error: String(error) };
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

  /**
   * Send a DM to a handle. BEST-EFFORT and UNVERIFIED against live x.com — the
   * DM composer DOM is especially volatile; validate against a real session.
   */
  async sendDM(input: DMInput): Promise<{ sent: boolean }> {
    return this.session.withPage(async (page) => {
      await page.goto(X.dmComposeUrl, { waitUntil: "domcontentloaded" });
      await this.assertLoggedIn(page);

      // Pick the recipient, then type + send.
      await page.waitForSelector('[data-testid="searchPeople"]').catch(() => {});
      await page.type('[data-testid="searchPeople"]', input.to, { delay: 25 });
      await page.waitForSelector(X.conversation, { timeout: 10_000 });
      await page.click(X.conversation);
      await page.click('[data-testid="nextButton"]').catch(() => {});

      await page.waitForSelector(X.dmEditor);
      await page.type(X.dmEditor, input.text, { delay: 25 });
      await page.waitForSelector(
        `${X.dmSendButton}:not([aria-disabled="true"])`,
      );
      await page.click(X.dmSendButton);
      return { sent: true };
    });
  }

  /**
   * Scrape the DM inbox for conversations with new activity. BEST-EFFORT and
   * UNVERIFIED — returns conversation-level items (not per-message); validate
   * and refine against a real session.
   */
  async pollDMs(cursor: string | null): Promise<WatchResult<DMThread>> {
    return this.session.withPage(async (page) => {
      await page.goto(X.messagesUrl, { waitUntil: "domcontentloaded" });
      await this.assertLoggedIn(page);
      await page.waitForSelector(X.conversation, { timeout: 15_000 }).catch(() => {});

      const threads = await page.$$eval(X.conversation, (convos) =>
        convos.map((c) => ({
          id: c.getAttribute("data-conversation-id") ?? c.textContent?.slice(0, 40) ?? "",
          preview: c.textContent ?? "",
        })),
      );

      const seen = new Set((cursor ?? "").split("|").filter(Boolean));
      const fresh = threads.filter((t) => t.id && !seen.has(t.id));
      const nextCursor = threads.map((t) => t.id).join("|") || cursor;
      return { items: fresh, cursor: nextCursor };
    });
  }

  /** Like a tweet. No-op if already liked. */
  async like(input: TargetInput): Promise<{ liked: boolean }> {
    return this.session.withPage(async (page) => {
      await page.goto(statusUrl(input.target), { waitUntil: "domcontentloaded" });
      await this.assertLoggedIn(page);
      const btn = await page.waitForSelector(X.likeButton, { timeout: 10_000 })
        .catch(() => null);
      if (!btn) return { liked: true }; // already liked (unlike button shown)
      await btn.click();
      return { liked: true };
    });
  }

  /** Repost (retweet) a tweet. */
  async retweet(input: TargetInput): Promise<{ retweeted: boolean }> {
    return this.session.withPage(async (page) => {
      await page.goto(statusUrl(input.target), { waitUntil: "domcontentloaded" });
      await this.assertLoggedIn(page);
      await page.waitForSelector(X.retweetButton);
      await page.click(X.retweetButton);
      await page.waitForSelector(X.retweetConfirm, { timeout: 10_000 });
      await page.click(X.retweetConfirm);
      return { retweeted: true };
    });
  }

  /** Quote-tweet: repost with a comment. */
  async quote(input: QuoteInput): Promise<PostResult> {
    return this.session.withPage(async (page) => {
      await page.goto(statusUrl(input.target), { waitUntil: "domcontentloaded" });
      await this.assertLoggedIn(page);
      await page.waitForSelector(X.retweetButton);
      await page.click(X.retweetButton);

      // The retweet menu offers "Quote"; pick it by text (no stable testid).
      await page.evaluate(() => {
        const items = Array.from(
          document.querySelectorAll('[role="menuitem"], a[role="link"]'),
        );
        const quote = items.find((el) => /quote/i.test(el.textContent ?? ""));
        (quote as HTMLElement | undefined)?.click();
      });

      await page.waitForSelector(X.tweetEditor);
      await page.type(X.tweetEditor, input.text, { delay: 25 });
      await page.waitForSelector(`${X.tweetButton}:not([aria-disabled="true"])`);
      await page.click(X.tweetButton);
      return { posted: true, url: statusUrl(input.target) };
    });
  }

  /** Follow a handle. No-op if already following. */
  async follow(input: FollowInput): Promise<{ followed: boolean }> {
    const handle = input.handle.replace(/^@/, "");
    return this.session.withPage(async (page) => {
      await page.goto(`${X.base}/${handle}`, { waitUntil: "domcontentloaded" });
      await this.assertLoggedIn(page);
      const btn = await page.waitForSelector(X.followButton, { timeout: 10_000 })
        .catch(() => null);
      if (!btn) return { followed: true }; // already following (button hidden)
      await btn.click();
      return { followed: true };
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
      {
        name: "twitter_dm",
        description: "Send a direct message to a handle.",
        run: (input) => this.sendDM(input as DMInput),
      },
      {
        name: "twitter_like",
        description: "Like a tweet (by URL or status id).",
        run: (input) => this.like(input as TargetInput),
      },
      {
        name: "twitter_retweet",
        description: "Repost (retweet) a tweet.",
        run: (input) => this.retweet(input as TargetInput),
      },
      {
        name: "twitter_quote",
        description: "Quote-tweet: repost with a comment.",
        run: (input) => this.quote(input as QuoteInput),
      },
      {
        name: "twitter_follow",
        description: "Follow a handle.",
        run: (input) => this.follow(input as FollowInput),
      },
    ];
  }

  get watchers(): readonly PlatformWatcher[] {
    return [
      {
        name: "twitter_mentions",
        kind: "mention",
        description:
          "Synthetic webhook: new mentions/replies/comments on the connected account since the last poll.",
        poll: (cursor) => this.pollMentions(cursor),
      },
      {
        name: "twitter_dms",
        kind: "dm",
        description:
          "Synthetic webhook: DM conversations with new activity since the last poll.",
        poll: (cursor) => this.pollDMs(cursor),
      },
    ];
  }
}
