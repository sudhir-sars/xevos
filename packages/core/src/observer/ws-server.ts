import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

import type { EventBus } from "../core/event-bus";
import type { Event } from "../core/schema";

import {
  eventSeq,
  parseClientFrame,
  PROTOCOL_VERSION,
  type EventFrame,
  type ServerFrame,
  type SnapshotFrame,
} from "./protocol";
import { buildSnapshot, type SnapshotSources } from "./snapshot";

const DEFAULT_PORT = 7077;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PATH = "/ws";

export interface ObserverServerOptions {
  bus: EventBus;
  sources: SnapshotSources;
  port?: number;
  host?: string;
  /** WebSocket upgrade path. HTTP routes are served on every other path. */
  path?: string;
  /**
   * Handles a message the UI sends to the principal (`POST /principal/message`).
   * Returns the published event id. Omit to disable the write endpoint.
   */
  onPrincipalMessage?: (content: string) => string;
}

export interface ObserverServer {
  port: number;
  host: string;
  path: string;
  /** Number of currently connected UI clients. */
  clientCount: number;
  close(): Promise<void>;
}

interface Client {
  socket: WebSocket;
  /** True once the snapshot has been sent and buffered events flushed. */
  ready: boolean;
  /** Events observed during the connect window, replayed after the snapshot. */
  pending: Event[];
  /** Per-connection frame counter. */
  seq: number;
}

/**
 * Hosts an HTTP server that:
 *   - `GET /health`   -> liveness + counts
 *   - `GET /snapshot` -> the current store snapshot as JSON (SSR / debugging)
 *   - upgrades `path` -> a WebSocket that emits a snapshot frame on connect,
 *     then streams every subsequent EventBus event as an event frame.
 *
 * The EventBus tap is registered once and fans out to all clients. Per-client
 * buffering closes the gap between "snapshot captured" and "subscribed": events
 * published during a client's handshake are queued and replayed (deduped
 * against the snapshot boundary) so no event is lost or seen out of order.
 */
export async function startObserverServer(
  options: ObserverServerOptions,
): Promise<ObserverServer> {
  const { bus, sources } = options;
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const path = options.path ?? DEFAULT_PATH;

  const clients = new Set<Client>();

  const send = (client: Client, frame: ServerFrame): void => {
    if (client.socket.readyState !== client.socket.OPEN) {
      return;
    }

    client.socket.send(JSON.stringify(frame));
  };

  const eventFrame = (client: Client, event: Event): EventFrame => ({
    v: PROTOCOL_VERSION,
    kind: "event",
    seq: client.seq++,
    ts: Date.now(),
    event,
  });

  const snapshotFrame = (
    client: Client,
    data: SnapshotFrame["data"],
  ): SnapshotFrame => ({
    v: PROTOCOL_VERSION,
    kind: "snapshot",
    seq: client.seq++,
    ts: Date.now(),
    data,
  });

  // Single broadcast tap, fanned out to every client.
  const disposeTap = bus.tap((event) => {
    for (const client of clients) {
      if (client.ready) {
        send(client, eventFrame(client, event));
      } else {
        client.pending.push(event);
      }
    }
  });

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleHttp(req, res, { sources, clientCount: clients.size, port });
  });

  const wss = new WebSocketServer({ server: httpServer, path });

  wss.on("connection", (socket: WebSocket) => {
    const client: Client = { socket, ready: false, pending: [], seq: 0 };
    clients.add(client);

    socket.on("close", () => clients.delete(client));
    socket.on("error", () => clients.delete(client));

    // Inbound: messages the UI sends to the principal over the same socket.
    socket.on("message", (data) => {
      const frame = parseClientFrame(data.toString());
      if (!frame) return;

      if (frame.kind === "principal_message") {
        const content = frame.content.trim();
        if (content === "" || !options.onPrincipalMessage) return;

        try {
          options.onPrincipalMessage(content);
        } catch (err) {
          console.error("[observer] onPrincipalMessage failed:", err);
        }
      }
    });

    void (async () => {
      try {
        // Capture the boundary BEFORE building the snapshot: this can only
        // over-count (causing a harmless dedup), never under-count (a gap).
        const throughSeq = bus.publishedCount;
        const snapshot = await buildSnapshot(sources, {
          capturedAt: Date.now(),
          throughSeq,
        });

        send(client, snapshotFrame(client, snapshot));

        // Replay events observed during the handshake, skipping any already
        // reflected in the snapshot.
        for (const event of client.pending) {
          if (eventSeq(event.id) > throughSeq) {
            send(client, eventFrame(client, event));
          }
        }

        client.pending = [];
        client.ready = true;
      } catch (err) {
        console.error("[observer] failed to send snapshot:", err);
        socket.close();
        clients.delete(client);
      }
    })();
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

      for (const client of clients) {
        client.socket.close();
      }

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

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpDeps,
): Promise<void> {
  // Read-only diagnostics + initial snapshot. All two-way messaging goes over
  // the WebSocket; these GETs are simple cross-origin requests (no preflight).
  res.setHeader("Access-Control-Allow-Origin", "*");

  const url = new URL(req.url ?? "/", `http://localhost:${deps.port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, clients: deps.clientCount });
    return;
  }

  if (req.method === "GET" && url.pathname === "/snapshot") {
    try {
      const snapshot = await buildSnapshot(deps.sources, {
        capturedAt: Date.now(),
        throughSeq: 0,
      });
      sendJson(res, 200, snapshot);
    } catch (err) {
      console.error("[observer] /snapshot failed:", err);
      sendJson(res, 500, { error: "failed to build snapshot" });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
