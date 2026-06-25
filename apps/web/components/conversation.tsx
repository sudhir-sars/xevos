"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { SendHorizonalIcon } from "lucide-react";

import type { Message } from "@xevos/core/protocol";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Conversation({
  messages,
  hasMore,
  loadMore,
  sendMessage,
}: {
  /** Oldest-first conversation history. */
  messages: Message[];
  hasMore: boolean;
  loadMore: () => void;
  sendMessage: (content: string) => boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSeqRef = useRef<number | null>(null);

  // Auto-scroll to the bottom only when a NEW message arrives (not when older
  // history is prepended).
  useEffect(() => {
    const latest = messages.length ? messages[messages.length - 1].seq : null;
    if (latest !== lastSeqRef.current) {
      lastSeqRef.current = latest;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

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
    <Card className="flex h-full min-h-0 flex-col  overflow-hidden  p-3">
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        {hasMore && (
          <button
            type="button"
            onClick={loadMore}
            className="mx-auto rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Load older messages
          </button>
        )}

        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-center text-sm text-muted-foreground">
              Send a message to the executive to get started.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex flex-col",
                message.outgoing ? "items-end" : "items-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-4xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                  message.outgoing
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                {message.content}
              </div>
              <span className="mt-1 px-1 font-mono text-[10px] text-muted-foreground">
                {message.outgoing ? "you → executive" : message.from} ·{" "}
                {formatTime(message.ts)}
              </span>
            </div>
          ))
        )}
      </div>

      <form onSubmit={onSubmit} className="flex shrink-0 flex-col gap-2  p-3">
        {error && <p className="px-1 text-xs text-destructive">{error}</p>}
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            placeholder="Message the executive… "
            className="max-h-32 min-h-[1.75rem] overflow-hidden flex-1 resize-none"
          />
          <Button
            type="submit"
            size="icon-lg"
            disabled={draft.trim() === ""}
            aria-label="Send message"
            className={"hidden"}
          >
            <SendHorizonalIcon />
          </Button>
        </div>
      </form>
    </Card>
  );
}
