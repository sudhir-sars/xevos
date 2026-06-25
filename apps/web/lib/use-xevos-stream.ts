"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  parseServerFrame,
  principalMessageFrame,
  type Event,
  type Snapshot,
} from "@xevos/core/protocol";

import {
  MAX_FEED,
  RECONNECT_DELAY_MS,
  REFRESH_DEBOUNCE_MS,
  SNAPSHOT_URL,
  WS_URL,
} from "./config";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface FeedItem {
  /** Per-connection frame sequence (unique within a session). */
  seq: number;
  ts: number;
  event: Event;
}

export interface StreamState {
  status: ConnectionStatus;
  /** Base state captured from the lowdb stores; null until first snapshot. */
  snapshot: Snapshot | null;
  /** Live tail of events from the EventBus tap, newest first. */
  feed: FeedItem[];
  /** Total events received this session (feed is capped; this is not). */
  received: number;
  lastError: string | null;
}

type Action =
  | { type: "connecting" }
  | { type: "open" }
  | { type: "closed" }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "event"; item: FeedItem };

const initialState: StreamState = {
  status: "connecting",
  snapshot: null,
  feed: [],
  received: 0,
  lastError: null,
};

/**
 * Event types that imply a store mutation, and so warrant refreshing the
 * snapshot (the bus carries signals, not full state deltas, so panels reflecting
 * the stores are refetched rather than patched). These are the legacy bus
 * request/response signals — still handled in case any path uses them.
 */
const STORE_MUTATING: ReadonlySet<Event["type"]> = new Set<Event["type"]>([
  "task_create_response",
  "task_update_response",
  "task_transition_response",
  "agent_creation_response",
  "agent_suspension_response",
  "agent_resume_response",
  "agent_termination_response",
]);

/**
 * TRIVIAL tools now apply their effect DIRECTLY (no bus request/response) and
 * announce it with a `tool_executed` observation event instead. These tool names
 * change the lowdb stores (agents/tasks), so an observation for any of them must
 * also trigger a snapshot refresh. (Coding tools mutate the sandbox, not the
 * stores, so they are intentionally excluded.)
 */
const STORE_MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "create_subordinate_agent",
  "create_and_assign_task",
  "update_task_status",
]);

/** Whether an event implies a store change the snapshot panels should reflect. */
function mutatesStore(event: Event): boolean {
  if (STORE_MUTATING.has(event.type)) return true;
  return (
    event.type === "tool_executed" && STORE_MUTATING_TOOLS.has(event.body.tool)
  );
}

function reducer(state: StreamState, action: Action): StreamState {
  switch (action.type) {
    case "connecting":
      return { ...state, status: "connecting" };

    case "open":
      return { ...state, status: "open", lastError: null };

    case "closed":
      return { ...state, status: "closed" };

    case "snapshot":
      return { ...state, snapshot: action.snapshot };

    case "event":
      return {
        ...state,
        received: state.received + 1,
        feed: [action.item, ...state.feed].slice(0, MAX_FEED),
      };

    default:
      return state;
  }
}

/**
 * Connects to the core observer WebSocket: seeds state from the snapshot frame,
 * then appends live events. Reconnects automatically, and refetches the
 * snapshot (debounced) when a store-mutating event arrives so the store-backed
 * panels stay current.
 */
export interface XevosStream extends StreamState {
  /**
   * Send a message to the executive over the live socket. Returns false if the
   * socket is not currently open (the caller can surface a "not connected"
   * error) — the message is not queued.
   */
  sendMessage: (content: string) => boolean;
}

export function useXevosStream(): XevosStream {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = (): void => {
      if (refreshTimer) clearTimeout(refreshTimer);

      refreshTimer = setTimeout(() => {
        void fetch(SNAPSHOT_URL)
          .then((res) =>
            res.ok
              ? (res.json() as Promise<Snapshot>)
              : Promise.reject(new Error(`snapshot HTTP ${res.status}`)),
          )
          .then((snapshot) => {
            if (!disposed) dispatch({ type: "snapshot", snapshot });
          })
          .catch(() => {
            // Non-fatal: the WS snapshot/feed remain authoritative.
          });
      }, REFRESH_DEBOUNCE_MS);
    };

    const connect = (): void => {
      if (disposed) return;

      dispatch({ type: "connecting" });
      socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => dispatch({ type: "open" });

      socket.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data !== "string") return;

        const frame = parseServerFrame(ev.data);
        if (!frame) return;

        if (frame.kind === "snapshot") {
          dispatch({ type: "snapshot", snapshot: frame.data });
          return;
        }

        dispatch({
          type: "event",
          item: { seq: frame.seq, ts: frame.ts, event: frame.event },
        });

        if (mutatesStore(frame.event)) scheduleRefresh();
      };

      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        dispatch({ type: "closed" });
        if (!disposed) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  const sendMessage = useCallback((content: string): boolean => {
    const socket = socketRef.current;
    const trimmed = content.trim();

    if (!socket || socket.readyState !== WebSocket.OPEN || trimmed === "") {
      return false;
    }

    socket.send(JSON.stringify(principalMessageFrame(trimmed)));
    return true;
  }, []);

  return { ...state, sendMessage };
}
