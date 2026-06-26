import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Cookie, CookieData } from "puppeteer-core";

import { SESSIONS_DIR } from "../browser/config";

/**
 * Persists a logged-in browser session (cookies) per account, so we log in once
 * and reuse it. Pluggable: the default is a local JSON file, but the host (e.g.
 * the core runtime) can supply a SQLite-backed implementation.
 *
 * SECURITY: these cookies are live credentials. Keep them local, out of version
 * control, and never log them.
 */
export interface SessionStore {
  load(account: string): Promise<CookieData[]>;
  save(account: string, cookies: Cookie[]): Promise<void>;
}

/** Sanitize an account handle into a safe filename. */
function safeName(account: string): string {
  return account.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class FileSessionStore implements SessionStore {
  constructor(private readonly dir: string = SESSIONS_DIR) {}

  private path(account: string): string {
    return join(this.dir, `${safeName(account)}.json`);
  }

  async load(account: string): Promise<CookieData[]> {
    try {
      const raw = await readFile(this.path(account), "utf8");
      return JSON.parse(raw) as CookieData[];
    } catch {
      return [];
    }
  }

  async save(account: string, cookies: Cookie[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(account), JSON.stringify(cookies, null, 2), {
      mode: 0o600,
    });
  }
}
