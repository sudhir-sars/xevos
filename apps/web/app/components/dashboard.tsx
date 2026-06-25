"use client";

import { useXevosStream, type ConnectionStatus } from "@/lib/use-xevos-stream";

import { Conversation } from "./conversation";
import { EventFeed, OrgPanel, PromptsPanel, TaskBoard } from "./panels";

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  connecting: "bg-amber-500",
  open: "bg-emerald-500",
  closed: "bg-red-500",
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  open: "Live",
  closed: "Disconnected",
};

export function Dashboard() {
  const { status, snapshot, feed, received, sendMessage } = useXevosStream();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Xevos Principal
          </h1>
          <p className="text-sm text-zinc-500">
            Live view of the multi-agent organization via the EventBus tap.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Stat label="Events" value={received} />
          {snapshot && (
            <Stat
              label="Snapshot"
              value={new Date(snapshot.capturedAt).toLocaleTimeString()}
            />
          )}
          <span className="flex items-center gap-2 rounded-full border border-black/[.08] px-3 py-1.5 text-sm dark:border-white/[.12]">
            <span
              className={`h-2 w-2 rounded-full ${STATUS_STYLES[status]} ${
                status === "open" ? "animate-pulse" : ""
              }`}
            />
            {STATUS_LABELS[status]}
          </span>
        </div>
      </header>

      {snapshot === null ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-black/[.12] py-24 text-sm text-zinc-500 dark:border-white/[.15]">
          {status === "closed"
            ? "Cannot reach the core observer. Is the core process running on :7077?"
            : "Loading initial snapshot from the stores…"}
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="flex flex-col gap-5">
            <Conversation feed={feed} sendMessage={sendMessage} />
          </div>
          <div className="flex flex-col gap-5">
            <OrgPanel agents={snapshot.agents} />
            <PromptsPanel prompts={snapshot.prompts} />
          </div>
          <div className="flex flex-col gap-5">
            <TaskBoard tasks={snapshot.tasks} />
            <EventFeed feed={feed} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-right">
      <div className="font-mono text-sm font-medium">{value}</div>
      <div className="text-xs uppercase tracking-wide text-zinc-400">
        {label}
      </div>
    </div>
  );
}
