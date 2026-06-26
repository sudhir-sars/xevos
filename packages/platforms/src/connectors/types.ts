import type { SessionHealth } from "../watch/health";

/** The kind of inbound activity a watcher surfaces (mirrors core's union). */
export type InboundKind = "mention" | "reply" | "comment" | "dm" | "follower";

/**
 * A typed platform action an agent can invoke (e.g. post a tweet, send a DM).
 * Effectful and outward-facing — the host should gate/rate-limit these.
 */
export interface PlatformAction<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly description: string;
  run(input: Input): Promise<Output>;
}

export interface WatchResult<Item> {
  /** New items strictly newer than the polled cursor, oldest-first. */
  items: Item[];
  /** Cursor to pass next poll; null if nothing new (keep the previous one). */
  cursor: string | null;
}

/**
 * A polling-based "synthetic webhook". These platforms don't push events, so we
 * poll on a cadence: each `poll(cursor)` returns only what's newer than the
 * cursor. The host runs it on a schedule and emits the items as bus events —
 * manufacturing the webhook the platform refuses to give us.
 */
export interface PlatformWatcher<Item = unknown> {
  readonly name: string;
  readonly description: string;
  /** What this watcher's items are, so the host can tag the emitted event. */
  readonly kind: InboundKind;
  poll(cursor: string | null): Promise<WatchResult<Item>>;
}

/** A platform wrapper: its effectful actions and its synthetic-webhook watchers. */
export interface PlatformConnector {
  readonly id: string;
  /** The connected account handle (scopes cursors and session). */
  readonly account: string;
  readonly actions: readonly PlatformAction[];
  readonly watchers: readonly PlatformWatcher[];
  /** Session liveness probe — drives the auto-escalate-on-expiry watcher. */
  health(): Promise<SessionHealth>;
}
