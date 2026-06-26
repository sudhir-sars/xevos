"use client";

import { useXevosStream } from "@/lib/use-xevos-stream";

import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Conversation } from "./conversation";
import {
  EventTable,
  OrgPanel,
  PromptsPanel,
  TaskTable,
} from "../components/panels";

export function Dashboard() {
  const {
    status,
    org,
    tasks,
    hasMoreTasks,
    loadMoreTasks,
    messages,
    hasMoreMessages,
    loadMoreMessages,
    feed,
    sendMessage,
  } = useXevosStream();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {org === null ? (
        <div className="flex flex-1 items-center justify-center p-5">
          <Card className="max-w-md p-8 text-center text-sm text-muted-foreground">
            {status === "closed"
              ? "Cannot reach the core observer. Is the core process running on :7077?"
              : "Loading organization state…"}
          </Card>
        </div>
      ) : (
        <>
          <StatsBar />
          <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(360px,420px)_1fr]">
            <div className="min-h-0">
              <Conversation
                messages={messages}
                hasMore={hasMoreMessages}
                loadMore={loadMoreMessages}
                sendMessage={sendMessage}
              />
            </div>

            <Card className="flex min-h-0 flex-col  overflow-hidden p-5">
              <Tabs
                defaultValue="tasks"
                className="flex h-full min-h-0 flex-col gap-0"
              >
                <div className="shrink-0">
                  <TabsList variant="line">
                    <TabsTrigger value="tasks">
                      Tasks
                      <Count n={org.stats.tasks} />
                    </TabsTrigger>
                    <TabsTrigger value="events">
                      Events
                      <Count n={feed.length} />
                    </TabsTrigger>
                    <TabsTrigger value="org">
                      Organization
                      <Count n={org.stats.agents} />
                    </TabsTrigger>
                    <TabsTrigger value="prompts">Prompts</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="tasks" className="min-h-0 overflow-hidden">
                  <TaskTable
                    tasks={tasks}
                    hasMore={hasMoreTasks}
                    onLoadMore={loadMoreTasks}
                  />
                </TabsContent>
                <TabsContent value="events" className="min-h-0 overflow-hidden">
                  <EventTable feed={feed} />
                </TabsContent>
                <TabsContent value="org" className="min-h-0 overflow-hidden">
                  <OrgPanel agents={org.agents} />
                </TabsContent>
                <TabsContent value="prompts" className="min-h-0 overflow-hidden">
                  <PromptsPanel prompts={org.prompts} />
                </TabsContent>
              </Tabs>
            </Card>
          </main>
        </>
      )}
    </div>
  );

  function StatsBar() {
    if (!org) return null;
    const s = org.stats;
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-6 border-b px-5 py-3">
        <Stat label="Agents" value={s.agents} />
        <Stat label="Active workers" value={s.activeWorkers} />
        <Stat label="Running tasks" value={s.runningTasks} />
        <Stat label="Tasks" value={s.tasks} />
        <Stat label="Queue" value={s.queueDepth} />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={
              status === "open"
                ? "h-2 w-2 rounded-full bg-emerald-500"
                : "h-2 w-2 rounded-full bg-zinc-400"
            }
          />
          {status}
        </div>
      </div>
    );
  }
}

function Count({ n }: { n: number }) {
  return (
    <span className="ml-1 rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
      {n}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="font-mono text-sm font-medium">{value}</div>
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
    </div>
  );
}
