"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import type { FeedItem } from "@/lib/use-xevos-stream";

interface Message {
  key: string;
  ts: number;
  /** Display name of the sender. */
  from: string;
  /** True when sent by the principal (the UI), false when received. */
  outgoing: boolean;
  content: string;
}

/** Derive the principal <-> agents conversation from the live event feed. */
function toMessages(feed: FeedItem[]): Message[] {
  const messages: Message[] = [];

  // feed is newest-first; iterate in reverse for chronological order.
  for (let i = feed.length - 1; i >= 0; i--) {
    const item = feed[i];
    const event = item.event;

    if (event.type !== "message") continue;
    if (event.source !== "principal" && event.target !== "principal") continue;

    const outgoing = event.source === "principal";
    messages.push({
      key: `${item.seq}-${event.id}`,
      ts: item.ts,
      from: outgoing ? "principal" : event.source,
      outgoing,
      content: event.body.content,
    });
  }

  return messages;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Conversation({
  feed,
  sendMessage,
}: {
  feed: FeedItem[];
  sendMessage: (content: string) => boolean;
}) {
  const messages = toMessages(feed);

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;

    if (sendMessage(content)) {
      setDraft("");
      setError(null);
    } else {
      setError("Not connected — message not sent.");
    }
  }

  return (
    <section className="flex min-h-[28rem] flex-1 flex-col rounded-xl border border-black/[.08] bg-white dark:border-white/[.12] dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-black/[.06] px-4 py-3 dark:border-white/[.08]">
        <h2 className="text-sm font-semibold tracking-tight">Executive</h2>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {messages.length}
        </span>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto p-4">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-600">
            Send a message to the executive to get started.
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.key}
              className={`flex flex-col ${
                message.outgoing ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  message.outgoing
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                }`}
              >
                {message.content}
              </div>
              <span className="mt-1 px-1 font-mono text-[10px] text-zinc-400">
                {message.outgoing ? "you → executive" : message.from} ·{" "}
                {formatTime(message.ts)}
              </span>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-2 border-t border-black/[.06] p-3 dark:border-white/[.08]"
      >
        {error && (
          <p className="px-1 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            placeholder="Message the executive…  (Enter to send, Shift+Enter for newline)"
            className="flex-1 resize-none rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/[.15]"
          />
          <button
            type="submit"
            disabled={draft.trim() === ""}
            className="h-10 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
