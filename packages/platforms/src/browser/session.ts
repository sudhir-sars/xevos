import puppeteer, { type Browser, type Page } from "puppeteer-core";

import { DEFAULT_TIMEOUT_MS, OBSCURA_CDP_URL } from "./config";
import type { SessionStore } from "../storage/sessions";

export interface BrowserSessionOptions {
  /** Account handle this session belongs to (scopes the stored cookies). */
  account: string;
  /** Where the logged-in session is persisted. */
  store: SessionStore;
  /** Obscura CDP endpoint; defaults to OBSCURA_CDP_URL. */
  endpoint?: string;
  timeoutMs?: number;
}

/**
 * A logged-in browser session driven through the Obscura engine over CDP. Loads
 * the account's persisted cookies before each task and saves the refreshed ones
 * after, so a one-time login is reused across runs.
 */
export class BrowserSession {
  private browser?: Browser;

  constructor(private readonly opts: BrowserSessionOptions) {}

  private endpoint(): string {
    return this.opts.endpoint ?? OBSCURA_CDP_URL;
  }

  private async connect(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    try {
      this.browser = await puppeteer.connect({
        browserWSEndpoint: this.endpoint(),
      });
    } catch (error) {
      throw new Error(
        `cannot reach the Obscura browser at ${this.endpoint()} — is the engine ` +
          `running ('obscura serve --port 9222')? ${String(error)}`,
      );
    }
    return this.browser;
  }

  /**
   * Run `fn` against a fresh page with the account's session loaded, then
   * persist any refreshed cookies. The page is always closed; the connection is
   * kept for reuse.
   */
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.connect();

    const cookies = await this.opts.store.load(this.opts.account);
    if (cookies.length > 0) await browser.setCookie(...cookies);

    const page = await browser.newPage();
    const timeout = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);

    try {
      return await fn(page);
    } finally {
      try {
        await this.opts.store.save(this.opts.account, await browser.cookies());
      } catch {
        /* persisting cookies is best-effort */
      }
      await page.close().catch(() => {});
    }
  }

  /** True if a session has been captured for this account. */
  async hasSession(): Promise<boolean> {
    return (await this.opts.store.load(this.opts.account)).length > 0;
  }

  async disconnect(): Promise<void> {
    await this.browser?.disconnect().catch(() => {});
    this.browser = undefined;
  }
}
