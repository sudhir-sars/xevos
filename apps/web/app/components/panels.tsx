import type {
  Agent,
  Department,
  Event,
  PromptsSnapshot,
  Task,
  TaskStatus,
} from "@xevos/core/protocol";

import type { FeedItem } from "@/lib/use-xevos-stream";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function summarizeBody(event: Event): string {
  const body = event.body as Record<string, unknown>;
  const text = JSON.stringify(body);
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

const TASK_COLUMNS: readonly TaskStatus[] = [
  "backlog",
  "assigned",
  "in_progress",
  "blocked",
  "in_review",
  "completed",
  "failed",
  "cancelled",
];

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

const TOPIC_STYLES: Record<Event["topic"], string> = {
  agent: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  task: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
};

function Card({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-black/[.08] bg-white dark:border-white/[.12] dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-black/[.06] px-4 py-3 dark:border-white/[.08]">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {count !== undefined && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {count}
          </span>
        )}
      </header>
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </section>
  );
}

export function OrgPanel({ agents }: { agents: Agent[] }) {
  const byDept = new Map<Department, Agent[]>();
  for (const agent of agents) {
    const list = byDept.get(agent.department) ?? [];
    list.push(agent);
    byDept.set(agent.department, list);
  }

  return (
    <Card title="Organization" count={agents.length}>
      {agents.length === 0 ? (
        <Empty label="No agents staffed yet." />
      ) : (
        <div className="flex flex-col gap-4">
          {[...byDept.entries()].map(([department, members]) => (
            <div key={department}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {department}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {members.map((agent) => (
                  <li
                    key={agent.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-black/[.05] px-3 py-2 text-sm dark:border-white/[.08]"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-zinc-500">
                        {agent.id}
                      </div>
                      <div className="truncate">{agent.objective}</div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                        agent.status === "active"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {agent.role}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function TaskBoard({ tasks }: { tasks: Task[] }) {
  const active = TASK_COLUMNS.filter((status) =>
    tasks.some((task) => task.status === status),
  );

  return (
    <Card title="Tasks" count={tasks.length}>
      {tasks.length === 0 ? (
        <Empty label="No tasks created yet." />
      ) : (
        <div className="flex flex-col gap-4">
          {active.map((status) => {
            const column = tasks.filter((task) => task.status === status);
            return (
              <div key={status}>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <span
                    className={`rounded-full px-2 py-0.5 ${TASK_STATUS_STYLES[status]}`}
                  >
                    {status.replace("_", " ")}
                  </span>
                  <span className="font-mono">{column.length}</span>
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {column.map((task) => (
                    <li
                      key={task.id}
                      className="rounded-lg border border-black/[.05] px-3 py-2 text-sm dark:border-white/[.08]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">
                          {task.title}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-zinc-500">
                          {task.priority}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                        {task.id}
                        {task.assignedTo ? ` → ${task.assignedTo}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function PromptsPanel({ prompts }: { prompts: PromptsSnapshot }) {
  const roles = Object.entries(prompts.roles);
  const departments = Object.entries(prompts.departments);

  return (
    <Card title="Prompts" count={roles.length + departments.length}>
      <div className="flex flex-col gap-4 text-sm">
        <PromptGroup label="Roles" entries={roles} />
        <PromptGroup label="Departments" entries={departments} />
      </div>
    </Card>
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
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </h3>
      {entries.length === 0 ? (
        <Empty label={`No ${label.toLowerCase()} defined.`} />
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {entries.map(([key]) => (
            <li
              key={key}
              className="rounded-full border border-black/[.08] px-2.5 py-1 font-mono text-xs text-zinc-600 dark:border-white/[.12] dark:text-zinc-400"
            >
              {key}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EventFeed({ feed }: { feed: FeedItem[] }) {
  return (
    <Card title="Live Event Feed" count={feed.length}>
      {feed.length === 0 ? (
        <Empty label="Waiting for events from the EventBus tap…" />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {feed.map(({ seq, ts, event }) => (
            <li
              key={`${seq}-${event.id}`}
              className="flex items-start gap-3 rounded-lg border border-black/[.05] px-3 py-2 text-sm dark:border-white/[.08]"
            >
              <span className="mt-0.5 shrink-0 font-mono text-xs text-zinc-400">
                {formatTime(ts)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${TOPIC_STYLES[event.topic]}`}
                  >
                    {event.type}
                  </span>
                  <span className="font-mono text-xs text-zinc-500">
                    {event.source} → {event.target}
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-xs text-zinc-500">
                  {summarizeBody(event)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-600">
      {label}
    </p>
  );
}
