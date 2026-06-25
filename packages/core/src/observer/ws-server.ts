import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

import type { EventBus } from "../core/event-bus";
import type { Event } from "../core/schema";

import {
  eventSeq,
  parseClientFrame,
  PROTOCOL_VERSION,
  type EventFrame,
  type Message,
  type MessageDeltaFrame,
  type OrgFrame,
  type ServerFrame,
  type TaskDeltaFrame,
} from "./protocol";
import { buildOrgState, pageMessages, pageTasks, tasksChangedSince } from "./queries";
import type { SnapshotSources } from "./snapshot";
import { getSqlite } from "../db/client";

const DEFAULT_PORT = 7077;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PATH = "/ws";

/** Coalesce bursts of bus events into one org+task refresh. */
const FLUSH_DEBOUNCE_MS = 150;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

export interface ObserverServerOptions {
  bus: EventBus;
  sources: SnapshotSources;
  port?: number;
  host?: string;
  path?: string;
  /** Publishes a principal->executive message; returns the event id. */
  onPrincipalMessage?: (content: string) => string;
}

export interface ObserverServer {
  port: number;
  host: string;
  path: string;
  clientCount: number;
  close(): Promise<void>;
}

function frame<T extends ServerFrame>(f: Omit<T, "v" | "ts">): T {
  return { v: PROTOCOL_VERSION, ts: Date.now(), ...f } as T;
}

function isPrincipalMessage(event: Event): boolean {
  return (
    event.topic === "agent" &&
    event.type === "message" &&
    (event.source === "principal" || event.target === "principal")
  );
}

function messageFromEvent(event: Event): Message {
  const content = (event as { body?: { content?: unknown } }).body?.content;
  return {
    id: event.id,
    seq: eventSeq(event.id),
    ts: Date.now(),
    from: event.source,
    to: event.target,
    outgoing: event.source === "principal",
    content: typeof content === "string" ? content : "",
  };
}

/**
 * Hosts the HTTP+WS observer.
 *   - `GET /health`            -> liveness + counts
 *   - `GET /org`               -> full org state (snapshot)
 *   - `GET /tasks?before&limit`    -> paginated task history (newest first)
 *   - `GET /messages?before&limit` -> paginated message history (newest first)
 *   - WebSocket `path`         -> `org` frame on connect, then `org`/`task`/
 *     `message`/`event` deltas.
 */
export async function startObserverServer(
  options: ObserverServerOptions,
): Promise<ObserverServer> {
  const { bus, sources } = options;
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const path = options.path ?? DEFAULT_PATH;

  const clients = new Set<WebSocket>();

  // Only emit task deltas for tasks changed after the server started; the
  // initial set is loaded by clients via GET /tasks.
  let taskWatermark =
    (
      getSqlite()
        .prepare("SELECT max(updated_at) AS m FROM tasks")
        .get() as { m: number | null }
    ).m ?? 0;

  const broadcast = (f: ServerFrame): void => {
    const payload = JSON.stringify(f);
    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  };

  // Debounced org + task-delta flush.
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    broadcast(frame<OrgFrame>({ kind: "org", org: buildOrgState(sources) }));
    for (const task of tasksChangedSince(taskWatermark)) {
      broadcast(frame<TaskDeltaFrame>({ kind: "task", task }));
      if (task.updatedAt > taskWatermark) taskWatermark = task.updatedAt;
    }
  };
  const scheduleFlush = (): void => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      try {
        flush();
      } catch (err) {
        console.error("[observer] flush failed:", err);
      }
    }, FLUSH_DEBOUNCE_MS);
  };

  const disposeTap = bus.tap((event) => {
    // Raw event for the live log.
    broadcast(frame<EventFrame>({ kind: "event", seq: eventSeq(event.id), event }));

    // Conversation messages stream immediately so chat feels live.
    if (isPrincipalMessage(event)) {
      broadcast(
        frame<MessageDeltaFrame>({ kind: "message", message: messageFromEvent(event) }),
      );
    }

    // Org/task state refresh, coalesced.
    scheduleFlush();
  });

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res, { sources, clientCount: clients.size, port });
  });

  const wss = new WebSocketServer({ server: httpServer, path });

  wss.on("connection", (socket: WebSocket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));

    socket.on("message", (data) => {
      const f = parseClientFrame(data.toString());
      if (!f || f.kind !== "principal_message") return;
      const content = f.content.trim();
      if (content === "" || !options.onPrincipalMessage) return;
      try {
        options.onPrincipalMessage(content);
      } catch (err) {
        console.error("[observer] onPrincipalMessage failed:", err);
      }
    });

    // Seed the client with current org state; tasks/messages load via HTTP.
    try {
      socket.send(
        JSON.stringify(frame<OrgFrame>({ kind: "org", org: buildOrgState(sources) })),
      );
    } catch (err) {
      console.error("[observer] failed to send org state:", err);
      socket.close();
      clients.delete(socket);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    httpServer.once("error", onError);
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", onError);
      resolve();
    });
  });

  console.log(
    `[observer] http+ws listening on http://${host}:${port} (ws path: ${path})`,
  );

  return {
    port,
    host,
    path,
    get clientCount(): number {
      return clients.size;
    },
    async close(): Promise<void> {
      disposeTap();
      if (flushTimer) clearTimeout(flushTimer);
      for (const socket of clients) socket.close();
      clients.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

interface HttpDeps {
  sources: SnapshotSources;
  clientCount: number;
  port: number;
}

function parseLimit(url: URL): number {
  const raw = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.floor(raw), MAX_PAGE_LIMIT);
}

function parseBefore(url: URL): number | null {
  const raw = url.searchParams.get("before");
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpDeps,
): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = new URL(req.url ?? "/", `http://localhost:${deps.port}`);

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }

  try {
    switch (url.pathname) {
      case "/health":
        return sendJson(res, 200, { ok: true, clients: deps.clientCount });
      case "/org":
        return sendJson(res, 200, buildOrgState(deps.sources));
      case "/tasks":
        return sendJson(res, 200, pageTasks(parseBefore(url), parseLimit(url)));
      case "/messages":
        return sendJson(
          res,
          200,
          pageMessages(parseBefore(url), parseLimit(url)),
        );
      default:
        return sendJson(res, 404, { error: "not found" });
    }
  } catch (err) {
    console.error(`[observer] ${url.pathname} failed:`, err);
    sendJson(res, 500, { error: "internal error" });
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
