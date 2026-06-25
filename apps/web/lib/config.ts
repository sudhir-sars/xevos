/** Core observer endpoints. Override via NEXT_PUBLIC_* env vars at build time. */
export const WS_URL =
  process.env.NEXT_PUBLIC_XEVOS_WS_URL ?? "ws://127.0.0.1:7077/ws";

export const SNAPSHOT_URL =
  process.env.NEXT_PUBLIC_XEVOS_SNAPSHOT_URL ??
  "http://127.0.0.1:7077/snapshot";

/** Cap on the in-memory live event feed. */
export const MAX_FEED = 500;

/** Delay before refetching the store snapshot after a mutating event. */
export const REFRESH_DEBOUNCE_MS = 250;

/** Delay before reconnecting a dropped WebSocket. */
export const RECONNECT_DELAY_MS = 1500;
