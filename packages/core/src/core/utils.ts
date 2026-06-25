import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { Department, Role } from "./schema";
const MODEL_ID = "gemini-3.1-flash-lite";
const RPM_PER_KEY = Number(process.env.GEMINI_RPM_PER_KEY ?? 15);
/**
 * A pool of Google providers, one per API key. Each key here belongs to a
 * DIFFERENT Google account, so each has its own independent free-tier quota
 * bucket — rotating across them genuinely multiplies throughput (unlike multiple
 * keys in one project, which share a single bucket).
 *
 * Keys come from GOOGLE_API_KEYS (comma-separated). If it is unset/empty we fall
 * back to a default provider, which reads GOOGLE_GENERATIVE_AI_API_KEY itself, so
 * the app still runs with no pool configured.
 */
const API_KEYS = (process.env.GOOGLE_API_KEYS ?? "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

const providers = (
  API_KEYS.length > 0
    ? API_KEYS.map((apiKey) => createGoogleGenerativeAI({ apiKey }))
    : [createGoogleGenerativeAI({})]
) as ReturnType<typeof createGoogleGenerativeAI>[];

/** Number of API keys (independent quota buckets) in the pool. */
export const API_KEY_COUNT = providers.length;

/** All roles use one model today; kept role-aware for easy future tiering. */
function modelIdFor(_role: Role): string {
  return MODEL_ID;
}

/**
 * Per-key rate limiting.
 *
 * Google's free tier for Flash-Lite is enforced PER PROJECT/account:
 *   - 15 RPM (requests / minute)
 *   - 250,000 TPM (tokens / minute)
 *   - 1,000 RPD (requests / day)
 * (See https://ai.google.dev/gemini-api/docs/rate-limits — exact caps vary by
 * account/region; check AI Studio for your live numbers.)
 *
 * Since each key is a separate account, we throttle EACH key on its own to just
 * under 15 RPM by spacing its requests at least MIN_INTERVAL_MS apart. With N
 * keys that yields ~N * 15 RPM aggregate. We do NOT enforce TPM or RPD here; RPD
 * (1,000 per key per day) is the real ceiling for long runs — with N keys that
 * is N * 1,000 requests/day before everything stalls until the daily reset.
 */

const RPM_SAFETY = 0.9; // stay a touch under the published cap to absorb jitter
const MIN_INTERVAL_MS = Math.ceil(
  60_000 / Math.max(1, RPM_PER_KEY * RPM_SAFETY),
);

/** Earliest epoch-ms at which each key may fire its next request. */
const keyNextFreeAt: number[] = new Array(providers.length).fill(0);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reserve the key that frees up soonest, waiting out its rate window, and
 * return its index. Reserving advances that key's window immediately, so
 * concurrent callers fan out across keys instead of piling onto one.
 */
async function reserveKey(): Promise<number> {
  let i = 0;
  for (let j = 1; j < keyNextFreeAt.length; j++) {
    if (keyNextFreeAt[j] < keyNextFreeAt[i]) i = j;
  }

  const now = Date.now();
  const earliest = Math.max(now, keyNextFreeAt[i]);
  keyNextFreeAt[i] = earliest + MIN_INTERVAL_MS;

  const wait = earliest - now;
  if (wait > 0) await sleep(wait);

  return i;
}

/**
 * Concurrency cap on in-flight requests. Per-key spacing already bounds the
 * request RATE; this just limits how many calls are open at once so a burst
 * can't spike memory/sockets. Defaults to the key count.
 */
const MODEL_MAX_CONCURRENCY = Number(
  process.env.MODEL_MAX_CONCURRENCY ?? API_KEY_COUNT,
);

let available = Math.max(1, MODEL_MAX_CONCURRENCY);
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (available > 0) {
    available--;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  // Hand the freed slot straight to the next waiter (count stays put);
  // only return it to the pool when nobody is waiting.
  if (next) next();
  else available++;
}

/**
 * Run `fn` with a rotated, rate-limited model: wait for the soonest key's rate
 * window, then take an in-flight slot, then invoke `fn` with that key's model.
 */
export async function withModel<T>(
  _department: Department,
  role: Role,
  fn: (model: LanguageModel) => Promise<T>,
): Promise<T> {
  const key = await reserveKey();
  await acquire();
  try {
    return await fn(providers[key](modelIdFor(role)));
  } finally {
    release();
  }
}
