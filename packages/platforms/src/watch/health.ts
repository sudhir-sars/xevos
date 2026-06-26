export interface SessionHealth {
  platform: string;
  account: string;
  loggedIn: boolean;
  checkedAt: number;
  /** Populated when a check throws (transient nav error, engine down, …). */
  error?: string;
}

export interface HealthWatchOptions {
  intervalMs?: number;
  /** Fired once when a healthy session transitions to logged-out. */
  onExpired?: (health: SessionHealth) => void | Promise<void>;
  /** Fired once when a previously-expired session is healthy again. */
  onRecovered?: (health: SessionHealth) => void | Promise<void>;
}

/**
 * Periodically run a session health check and fire edge callbacks on
 * transitions. The host wires `onExpired` to an escalation (a bus event /
 * Human-Liaison ping), so an expired login surfaces as the rare human-in-the-
 * loop moment instead of silently breaking automation. Returns a stop function.
 *
 * Framework-agnostic on purpose: it knows nothing about the bus — the host
 * supplies the callbacks.
 */
export function watchSessionHealth(
  check: () => Promise<SessionHealth>,
  opts: HealthWatchOptions = {},
): () => void {
  const intervalMs = opts.intervalMs ?? 5 * 60_000;
  let last: boolean | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const health = await check();
      // Only act on a definite signal (ignore transient check errors).
      if (health.error === undefined) {
        if (last === true && !health.loggedIn) await opts.onExpired?.(health);
        if (last === false && health.loggedIn) await opts.onRecovered?.(health);
        last = health.loggedIn;
      }
    } catch {
      /* transient — keep watching, don't flip state */
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };

  timer = setTimeout(() => void tick(), 0);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
