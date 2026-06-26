"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  parseServerFrame,
  principalMessageFrame,
  type Event,
  type Message,
  type OrgState,
  type Page,
  type Task,
} from "@xevos/core/protocol";

import {
  MAX_FEED,
  MESSAGES_URL,
  PAGE_SIZE,
  RECONNECT_DELAY_MS,
  TASKS_URL,
  WS_URL,
} from "./config";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface FeedItem {
  seq: number;
  ts: number;
  event: Event;
}

interface State {
  status: ConnectionStatus;
  /** Live org state (snapshot + deltas); null until first frame. */
  org: OrgState | null;
  /** Tasks, newest-first; initial page via HTTP, then delta upserts. */
  tasks: Task[];
  hasMoreTasks: boolean;
  /** Conversation messages, oldest-first; paginated history + append deltas. */
  messages: Message[];
  hasMoreMessages: boolean;
  /** Live raw-event tail, newest-first, capped (the Events view). */
  feed: FeedItem[];
  lastError: string | null;
}

const initialState: State = {
  status: "connecting",
  org: null,
  tasks: [],
  hasMoreTasks: false,
  messages: [],
  hasMoreMessages: false,
  feed: [],
  lastError: null,
};

type Action =
  | { type: "status"; status: ConnectionStatus }
  | { type: "org"; org: OrgState }
  | { type: "task"; task: Task }
  | { type: "message"; message: Message }
  | { type: "event"; item: FeedItem }
  | { type: "tasksPage"; items: Task[]; hasMore: boolean; initial: boolean }
  | { type: "messagesPage"; items: Message[]; hasMore: boolean; initial: boolean };

function upsertTask(tasks: Task[], task: Task): Task[] {
  const i = tasks.findIndex((t) => t.id === task.id);
  if (i === -1) return [task, ...tasks]; // new -> newest
  const next = tasks.slice();
  next[i] = task; // changed -> keep position
  return next;
}

function appendMessage(messages: Message[], message: Message): Message[] {
  if (messages.some((m) => m.seq === message.seq)) return messages;
  return [...messages, message];
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "status":
      return {
        ...state,
        status: action.status,
        lastError: action.status === "open" ? null : state.lastError,
      };
    case "org":
      return { ...state, org: action.org };
    case "task":
      return { ...state, tasks: upsertTask(state.tasks, action.task) };
    case "message":
      return { ...state, messages: appendMessage(state.messages, action.message) };
    case "event":
      return {
        ...state,
        feed: [action.item, ...state.feed].slice(0, MAX_FEED),
      };
    case "tasksPage": {
      // HTTP pages are newest-first; initial replaces, "more" appends (older).
      const merged = action.initial
        ? action.items
        : [...state.tasks, ...action.items.filter((t) => !state.tasks.some((s) => s.id === t.id))];
      return { ...state, tasks: merged, hasMoreTasks: action.hasMore };
    }
    case "messagesPage": {
      // HTTP pages are newest-first; we keep messages oldest-first.
      const olderAsc = [...action.items].reverse();
      const existing = new Set(state.messages.map((m) => m.seq));
      const fresh = olderAsc.filter((m) => !existing.has(m.seq));
      const merged = action.initial ? fresh : [...fresh, ...state.messages];
      return { ...state, messages: merged, hasMoreMessages: action.hasMore };
    }
    default:
      return state;
  }
}

export interface XevosStream extends State {
  sendMessage: (content: string) => boolean;
  loadMoreTasks: () => void;
  loadMoreMessages: () => void;
}

async function fetchPage<T>(
  url: string,
  before: number | null,
): Promise<Page<T>> {
  const u = new URL(url);
  u.searchParams.set("limit", String(PAGE_SIZE));
  if (before !== null) u.searchParams.set("before", String(before));
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Page<T>;
}

export function useXevosStream(): XevosStream {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef<WebSocket | null>(null);

  // Pagination cursors + in-flight guards live in refs to avoid stale closures.
  const taskCursor = useRef<number | null>(null);
  const messageCursor = useRef<number | null>(null);
  const loadingTasks = useRef(false);
  const loadingMessages = useRef(false);
  const disposedRef = useRef(false);

  const loadTasks = useCallback(async (initial: boolean) => {
    if (loadingTasks.current) return;
    if (!initial && taskCursor.current === null) return;
    loadingTasks.current = true;
    try {
      const page = await fetchPage<Task>(
        TASKS_URL,
        initial ? null : taskCursor.current,
      );
      taskCursor.current = page.nextCursor;
      if (!disposedRef.current) {
        dispatch({
          type: "tasksPage",
          items: page.items,
          hasMore: page.nextCursor !== null,
          initial,
        });
      }
    } catch {
      /* non-fatal: deltas keep the view live */
    } finally {
      loadingTasks.current = false;
    }
  }, []);

  const loadMessages = useCallback(async (initial: boolean) => {
    if (loadingMessages.current) return;
    if (!initial && messageCursor.current === null) return;
    loadingMessages.current = true;
    try {
      const page = await fetchPage<Message>(
        MESSAGES_URL,
        initial ? null : messageCursor.current,
      );
      messageCursor.current = page.nextCursor;
      if (!disposedRef.current) {
        dispatch({
          type: "messagesPage",
          items: page.items,
          hasMore: page.nextCursor !== null,
          initial,
        });
      }
    } catch {
      /* non-fatal */
    } finally {
      loadingMessages.current = false;
    }
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = (): void => {
      if (disposedRef.current) return;
      dispatch({ type: "status", status: "connecting" });
      socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        dispatch({ type: "status", status: "open" });
        // Seed the paginated histories once connected.
        void loadTasks(true);
        void loadMessages(true);
      };

      socket.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data !== "string") return;
        const frame = parseServerFrame(ev.data);
        if (!frame) return;

        switch (frame.kind) {
          case "org":
            dispatch({ type: "org", org: frame.org });
            break;
          case "task":
            dispatch({ type: "task", task: frame.task });
            break;
          case "message":
            dispatch({ type: "message", message: frame.message });
            break;
          case "event":
            dispatch({
              type: "event",
              item: { seq: frame.seq, ts: frame.ts, event: frame.event },
            });
            break;
        }
      };

      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        dispatch({ type: "status", status: "closed" });
        if (!disposedRef.current) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    };

    connect();

    return () => {
      disposedRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [loadTasks, loadMessages]);

  const sendMessage = useCallback((content: string): boolean => {
    const socket = socketRef.current;
    const trimmed = content.trim();
    if (!socket || socket.readyState !== WebSocket.OPEN || trimmed === "") {
      return false;
    }
    socket.send(JSON.stringify(principalMessageFrame(trimmed)));
    return true;
  }, []);

  const loadMoreTasks = useCallback(() => void loadTasks(false), [loadTasks]);
  const loadMoreMessages = useCallback(
    () => void loadMessages(false),
    [loadMessages],
  );

  return { ...state, sendMessage, loadMoreTasks, loadMoreMessages };
}
