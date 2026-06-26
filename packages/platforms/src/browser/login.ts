import type { CookieData, Page } from "puppeteer-core";

import type { SessionStore } from "../storage/sessions";
import type { BrowserSession } from "./session";

/**
 * Normalize one exported cookie (Cookie-Editor / EditThisCookie / puppeteer
 * shapes all differ) into puppeteer's CookieData. Returns null if it isn't a
 * usable cookie.
 */
function normalizeCookie(input: unknown): CookieData | null {
  if (typeof input !== "object" || input === null) return null;
  const c = input as Record<string, unknown>;
  if (
    typeof c.name !== "string" ||
    typeof c.value !== "string" ||
    typeof c.domain !== "string"
  ) {
    return null;
  }

  // Match exactly: "no_restriction" (Cookie-Editor) contains the substring
  // "strict", so a loose includes() would mis-map None -> Strict.
  const ss = String(c.sameSite ?? "").toLowerCase();
  const sameSite: CookieData["sameSite"] | undefined =
    ss === "no_restriction" || ss === "none"
      ? "None"
      : ss === "strict"
        ? "Strict"
        : ss === "lax"
          ? "Lax"
          : undefined;

  const expires =
    typeof c.expires === "number"
      ? c.expires
      : typeof c.expirationDate === "number"
        ? c.expirationDate
        : undefined;

  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: typeof c.path === "string" ? c.path : "/",
    ...(typeof c.secure === "boolean" ? { secure: c.secure } : {}),
    ...(typeof c.httpOnly === "boolean" ? { httpOnly: c.httpOnly } : {}),
    ...(sameSite ? { sameSite } : {}),
    ...(expires !== undefined ? { expires } : {}),
  };
}

/**
 * Import a session captured elsewhere — typically cookies exported from your
 * own logged-in browser via a Cookie-Editor extension. The easiest, CAPTCHA-
 * free, one-time bootstrap: no automated login at all. Accepts a JSON string or
 * an already-parsed array. Returns the number of cookies stored.
 */
export async function importCookies(
  store: SessionStore,
  account: string,
  raw: string | unknown[],
): Promise<number> {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed)) {
    throw new Error("expected a cookie array (JSON export)");
  }

  const cookies = parsed
    .map(normalizeCookie)
    .filter((c): c is CookieData => c !== null);

  if (cookies.length === 0) throw new Error("no usable cookies in the import");

  await store.save(account, cookies);
  return cookies.length;
}

/**
 * Interactive one-time capture: open the login page and poll until `isLoggedIn`
 * returns true (you log in by hand — solving any CAPTCHA/2FA that one time),
 * then the refreshed cookies are persisted automatically by withPage. Use this
 * when you can see the browser (Obscura non-headless); otherwise prefer
 * importCookies.
 */
export async function waitForLogin(
  session: BrowserSession,
  opts: {
    loginUrl: string;
    isLoggedIn: (page: Page) => Promise<boolean>;
    timeoutMs?: number;
    pollMs?: number;
  },
): Promise<void> {
  await session.withPage(async (page) => {
    await page.goto(opts.loginUrl, { waitUntil: "domcontentloaded" });
    const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
    const pollMs = opts.pollMs ?? 2_000;

    while (Date.now() < deadline) {
      if (await opts.isLoggedIn(page)) return;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error("login was not completed within the timeout");
  });
}
