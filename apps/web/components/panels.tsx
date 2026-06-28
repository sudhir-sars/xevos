"use client";

import { useState } from "react";
import { Maximize2Icon } from "lucide-react";

import type {
  Agent,
  Department,
  Event,
  PromptsSnapshot,
  Task,
  TaskStatus,
} from "@xevos/core/protocol";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import type { FeedItem } from "@/lib/use-xevos-stream";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  backlog: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  assigned: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  blocked: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  in_review:
    "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  completed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

const PRIORITY_STYLES: Record<Task["priority"], string> = {
  low: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  normal: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  high: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  urgent: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const TOPIC_STYLES: Record<Event["topic"], string> = {
  agent: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  task: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  observation:
    "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  platform:
    "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300",
};

function Pill({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Shared layout for the scrollable body of each tab. */
function PanelScroll({ children }: { children: React.ReactNode }) {
  return <div className="h-full min-h-0 overflow-y-auto p-4">{children}</div>;
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center">
      <p className="text-center text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-1.5 text-sm">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

export function TaskTable({
  tasks,
  hasMore = false,
  onLoadMore,
}: {
  tasks: Task[];
  hasMore?: boolean;
  onLoadMore?: () => void;
}) {
  const [selected, setSelected] = useState<Task | null>(null);

  if (tasks.length === 0) {
    return <Empty label="No tasks created yet." />;
  }

  return (
    <PanelScroll>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Assignee</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <TableRow
              key={task.id}
              className="cursor-pointer"
              onClick={() => setSelected(task)}
            >
              <TableCell className="max-w-[16rem]">
                <div className="truncate font-medium">{task.title}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {task.id}
                </div>
              </TableCell>
              <TableCell>
                <Pill className={TASK_STATUS_STYLES[task.status]}>
                  {task.status.replace("_", " ")}
                </Pill>
              </TableCell>
              <TableCell>
                <Pill className={PRIORITY_STYLES[task.priority]}>
                  {task.priority}
                </Pill>
              </TableCell>
              <TableCell className="max-w-[10rem]">
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {task.assignedTo ?? "—"}
                </span>
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="View task details"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(task);
                  }}
                >
                  <Maximize2Icon />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {hasMore && onLoadMore && (
        <button
          type="button"
          onClick={onLoadMore}
          className="mx-auto mt-3 block rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          Load older tasks
        </button>
      )}

      <TaskDetailDialog
        task={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </PanelScroll>
  );
}

function TaskDetailDialog({
  task,
  onOpenChange,
}: {
  task: Task | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto sm:max-w-2xl">
        {task && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8">{task.title}</DialogTitle>
              <DialogDescription className="font-mono">
                {task.id}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-2 flex flex-wrap gap-2">
              <Pill className={TASK_STATUS_STYLES[task.status]}>
                {task.status.replace("_", " ")}
              </Pill>
              <Pill className={PRIORITY_STYLES[task.priority]}>
                {task.priority} priority
              </Pill>
            </div>

            <Separator className="my-4" />

            <div className="divide-y divide-border">
              <DetailField label="Description">
                <p className="whitespace-pre-wrap">
                  {task.description || "—"}
                </p>
              </DetailField>
              <DetailField label="Assignee">
                <span className="font-mono text-xs">
                  {task.assignedTo ?? "Unassigned"}
                </span>
              </DetailField>
              <DetailField label="Acceptance">
                {task.acceptanceCriteria.length === 0 ? (
                  "—"
                ) : (
                  <ul className="list-disc space-y-1 pl-4">
                    {task.acceptanceCriteria.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </DetailField>
              <DetailField label="Dependencies">
                {task.dependencies.length === 0 ? (
                  "—"
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {task.dependencies.map((d) => (
                      <Badge key={d} variant="outline" className="font-mono">
                        {d}
                      </Badge>
                    ))}
                  </div>
                )}
              </DetailField>
              <DetailField label="Deadline">
                {formatDateTime(task.deadline)}
              </DetailField>
              <DetailField label="Budget">
                <span className="font-mono text-xs">
                  {task.budget.maxTokens.toLocaleString()} tok · $
                  {task.budget.maxUsd}
                </span>
              </DetailField>
              {task.review && (
                <DetailField label="Review">
                  <div className="space-y-1">
                    <Badge
                      variant={
                        task.review.verdict === "approved"
                          ? "default"
                          : "destructive"
                      }
                    >
                      {task.review.verdict.replace("_", " ")}
                    </Badge>
                    <p className="text-xs text-muted-foreground">
                      by {task.review.reviewer}
                    </p>
                    {task.review.notes && (
                      <p className="whitespace-pre-wrap">
                        {task.review.notes}
                      </p>
                    )}
                  </div>
                </DetailField>
              )}
              <DetailField label="Created">
                {formatDateTime(task.createdAt)}
              </DetailField>
              <DetailField label="Updated">
                {formatDateTime(task.updatedAt)}
              </DetailField>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

export function EventTable({ feed }: { feed: FeedItem[] }) {
  const [selected, setSelected] = useState<FeedItem | null>(null);

  if (feed.length === 0) {
    return <Empty label="Waiting for events from the EventBus tap…" />;
  }

  return (
    <PanelScroll>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Flow</TableHead>
            <TableHead>Summary</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {feed.map((item) => {
            const { seq, ts, event } = item;
            return (
              <TableRow
                key={`${seq}-${event.id}`}
                className="cursor-pointer"
                onClick={() => setSelected(item)}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {formatTime(ts)}
                </TableCell>
                <TableCell>
                  <Pill className={TOPIC_STYLES[event.topic]}>
                    {event.type}
                  </Pill>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {event.source} → {event.target}
                </TableCell>
                <TableCell className="max-w-[18rem]">
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {summarizeBody(event)}
                  </span>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="View event details"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(item);
                    }}
                  >
                    <Maximize2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <EventDetailDialog
        item={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </PanelScroll>
  );
}

function summarizeBody(event: Event): string {
  const text = JSON.stringify(event.body);
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

function EventDetailDialog({
  item,
  onOpenChange,
}: {
  item: FeedItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto sm:max-w-2xl">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 pr-8">
                <Pill className={TOPIC_STYLES[item.event.topic]}>
                  {item.event.type}
                </Pill>
              </DialogTitle>
              <DialogDescription className="font-mono">
                {item.event.id} · seq {item.seq}
              </DialogDescription>
            </DialogHeader>

            <Separator className="my-4" />

            <div className="divide-y divide-border">
              <DetailField label="Topic">{item.event.topic}</DetailField>
              <DetailField label="Source">
                <span className="font-mono text-xs">{item.event.source}</span>
              </DetailField>
              <DetailField label="Target">
                <span className="font-mono text-xs">{item.event.target}</span>
              </DetailField>
              {item.event.correlationId && (
                <DetailField label="Correlates">
                  <span className="font-mono text-xs">
                    {item.event.correlationId}
                  </span>
                </DetailField>
              )}
              <DetailField label="Time">{formatDateTime(item.ts)}</DetailField>
            </div>

            <h3 className="mt-4 mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Payload
            </h3>
            <pre className="overflow-x-auto rounded-3xl bg-muted p-3 font-mono text-xs">
              {JSON.stringify(item.event.body, null, 2)}
            </pre>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Organization                                                                */
/* -------------------------------------------------------------------------- */

export function OrgPanel({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) {
    return <Empty label="No agents staffed yet." />;
  }

  const byDept = new Map<Department, Agent[]>();
  for (const agent of agents) {
    const list = byDept.get(agent.department) ?? [];
    list.push(agent);
    byDept.set(agent.department, list);
  }

  return (
    <PanelScroll>
      <div className="flex flex-col gap-5">
        {[...byDept.entries()].map(([department, members]) => (
          <div key={department}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {department}
              <span className="font-mono">{members.length}</span>
            </h3>
            <ul className="flex flex-col gap-1.5">
              {members.map((agent) => (
                <li
                  key={agent.id}
                  className="flex items-center justify-between gap-2 rounded-3xl ring-1 ring-foreground/10 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {agent.id}
                    </div>
                    <div className="truncate">{agent.objective}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="outline">{agent.role}</Badge>
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        agent.status === "active"
                          ? "bg-emerald-500"
                          : "bg-zinc-400",
                      )}
                      title={agent.status}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </PanelScroll>
  );
}

/* -------------------------------------------------------------------------- */
/* Prompts                                                                     */
/* -------------------------------------------------------------------------- */

export function PromptsPanel({ prompts }: { prompts: PromptsSnapshot }) {
  const roles = Object.entries(prompts.roles);
  const departments = Object.entries(prompts.departments);

  return (
    <PanelScroll>
      <div className="flex flex-col gap-5">
        <PromptGroup label="Roles" entries={roles} />
        <PromptGroup label="Departments" entries={departments} />
      </div>
    </PanelScroll>
  );
}

function PromptGroup({
  label,
  entries,
}: {
  label: string;
  entries: [string, string | undefined][];
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No {label.toLowerCase()} defined.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {entries.map(([key]) => (
            <li key={key}>
              <Badge variant="secondary" className="font-mono">
                {key}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
