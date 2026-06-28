import { eq } from "drizzle-orm";
import {
  watchSessionHealth,
  type PlatformConnector,
  type PlatformWatcher,
} from "@xevos/platforms";

import type { EventBus } from "../event-bus";
import type {
  EndpointId,
  PlatformInboundEvent,
  PlatformInboundKind,
  PlatformSessionExpiredEvent,
  ServiceId,
} from "../schema";
import { getDb, type DB } from "../../db/client";
import { platformCursors } from "../../db/schema";
import { OBSERVER_ID } from "./tool/ztypes";

export const CONNECTOR_SERVICE_ID: ServiceId = "connector_service";

export interface ConnectorServiceOptions {
  bus: EventBus;
  connectors: PlatformConnector[];
  /**
   * Where inbound platform activity is addressed. Default: the observer sink, so
   * it streams to the dashboard. Point it at a marketing/support agent to have
   * one react to it.
   */
  inboundTarget?: EndpointId;
  /** Where session-expiry escalations go. Default: same as inboundTarget. */
  escalationTarget?: EndpointId;
  pollIntervalMs?: number;
  healthIntervalMs?: number;
  db?: DB;
}

/**
 * Drives the platform connectors: runs each watcher on a cadence, dedups via a
 * persisted cursor, and PUSHES every new item onto the event bus as a
 * `platform_inbound` event — which from there fans out to the dashboard
 * (observer WebSocket) and into the target's inbox for an agent to act on. This
 * is the "event push" for platforms that have no real webhooks. It also probes
 * each session and escalates on expiry.
 */
export class ConnectorService {
  private running = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly stops: Array<() => void> = [];
  private readonly db: DB;

  constructor(private readonly opts: ConnectorServiceOptions) {
    this.db = opts.db ?? getDb();
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    const inbound = this.opts.inboundTarget ?? (OBSERVER_ID as EndpointId);
    const escalation = this.opts.escalationTarget ?? inbound;
    const pollMs = this.opts.pollIntervalMs ?? 60_000;
    const healthMs = this.opts.healthIntervalMs ?? 5 * 60_000;

    for (const connector of this.opts.connectors) {
      for (const watcher of connector.watchers) {
        this.scheduleWatcher(connector, watcher, inbound, pollMs);
      }

      this.stops.push(
        watchSessionHealth(() => connector.health(), {
          intervalMs: healthMs,
          onExpired: (h) =>
            this.publishExpired(connector, escalation, h.error),
        }),
      );
    }
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const s of this.stops) s();
    this.stops.length = 0;
  }

  private cursorKey(connector: PlatformConnector, watcher: PlatformWatcher): string {
    return `${connector.id}:${connector.account}:${watcher.name}`;
  }

  private loadCursor(key: string): string | null {
    return (
      this.db
        .select()
        .from(platformCursors)
        .where(eq(platformCursors.key, key))
        .get()?.cursor ?? null
    );
  }

  private saveCursor(key: string, cursor: string): void {
    const updatedAt = Date.now();
    this.db
      .insert(platformCursors)
      .values({ key, cursor, updatedAt })
      .onConflictDoUpdate({
        target: platformCursors.key,
        set: { cursor, updatedAt },
      })
      .run();
  }

  private scheduleWatcher(
    connector: PlatformConnector,
    watcher: PlatformWatcher,
    target: EndpointId,
    pollMs: number,
  ): void {
    const key = this.cursorKey(connector, watcher);

    const tick = async (): Promise<void> => {
      if (!this.running) return;
      try {
        const cursor = this.loadCursor(key);
        const { items, cursor: next } = await watcher.poll(cursor);
        for (const item of items) {
          this.publishInbound(connector, watcher.kind, item, target);
        }
        if (next !== null && next !== cursor) this.saveCursor(key, next);
      } catch (err) {
        console.error(`[connector] ${key} poll failed:`, err);
      }
      if (this.running) {
        const t = setTimeout(() => void tick(), pollMs);
        this.timers.add(t);
      }
    };

    const t = setTimeout(() => void tick(), 0);
    this.timers.add(t);
  }

  private publishInbound(
    connector: PlatformConnector,
    kind: PlatformInboundKind,
    item: unknown,
    target: EndpointId,
  ): void {
    this.opts.bus.publish<PlatformInboundEvent>({
      source: CONNECTOR_SERVICE_ID,
      target,
      topic: "platform",
      type: "platform_inbound",
      body: {
        platform: connector.id,
        account: connector.account,
        kind,
        item,
      },
    });
  }

  private publishExpired(
    connector: PlatformConnector,
    target: EndpointId,
    reason?: string,
  ): void {
    this.opts.bus.publish<PlatformSessionExpiredEvent>({
      source: CONNECTOR_SERVICE_ID,
      target,
      topic: "platform",
      type: "platform_session_expired",
      body: { platform: connector.id, account: connector.account, reason },
    });
  }
}
