/** Core observer endpoints. Override via NEXT_PUBLIC_* env vars at build time. */
const HTTP_BASE =
  process.env.NEXT_PUBLIC_XEVOS_HTTP_URL ?? "http://127.0.0.1:7077";

export const WS_URL =
  process.env.NEXT_PUBLIC_XEVOS_WS_URL ?? "ws://127.0.0.1:7077/ws";

export const ORG_URL = `${HTTP_BASE}/org`;
export const TASKS_URL = `${HTTP_BASE}/tasks`;
export const MESSAGES_URL = `${HTTP_BASE}/messages`;

/** Page size for the paginated task/message history fetches. */
export const PAGE_SIZE = 50;

/** Cap on the in-memory live event feed (the debug Events view). */
export const MAX_FEED = 500;

/** Delay before reconnecting a dropped WebSocket. */
export const RECONNECT_DELAY_MS = 1500;
