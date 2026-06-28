/**
 * The Obscura engine's Chrome DevTools Protocol endpoint. Obscura runs as a
 * standalone process (`obscura serve --port 9222`) and speaks CDP, so we drive
 * it with puppeteer-core — no bundled browser. Override per deployment.
 */
export const OBSCURA_CDP_URL =
  process.env.OBSCURA_CDP_URL ?? "ws://127.0.0.1:9222/devtools/browser";

/** Where per-account session cookies are persisted (file store default). */
export const SESSIONS_DIR =
  process.env.XEVOS_SESSIONS_DIR ?? "./storage/sessions";

/** Default navigation/action timeout (ms). */
export const DEFAULT_TIMEOUT_MS = Number(
  process.env.XEVOS_BROWSER_TIMEOUT_MS ?? 30_000,
);
