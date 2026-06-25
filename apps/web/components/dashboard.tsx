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
  const { status, snapshot, feed, sendMessage } = useXevosStream();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {snapshot === null ? (
        <div className="flex flex-1 items-center justify-center p-5">
          <Card className="max-w-md p-8 text-center text-sm text-muted-foreground">
            {status === "closed"
              ? "Cannot reach the core observer. Is the core process running on :7077?"
              : "Loading initial snapshot from the stores…"}
          </Card>
        </div>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(360px,420px)_1fr]">
          <div className="min-h-0">
            <Conversation feed={feed} sendMessage={sendMessage} />
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
                    <Count n={snapshot.tasks.length} />
                  </TabsTrigger>
                  <TabsTrigger value="events">
                    Events
                    <Count n={feed.length} />
                  </TabsTrigger>
                  <TabsTrigger value="org">
                    Organization
                    <Count n={snapshot.agents.length} />
                  </TabsTrigger>
                  <TabsTrigger value="prompts">Prompts</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="tasks" className="min-h-0 overflow-hidden">
                <TaskTable tasks={snapshot.tasks} />
              </TabsContent>
              <TabsContent value="events" className="min-h-0 overflow-hidden">
                <EventTable feed={feed} />
              </TabsContent>
              <TabsContent value="org" className="min-h-0 overflow-hidden">
                <OrgPanel agents={snapshot.agents} />
              </TabsContent>
              <TabsContent value="prompts" className="min-h-0 overflow-hidden">
                <PromptsPanel prompts={snapshot.prompts} />
              </TabsContent>
            </Tabs>
          </Card>
        </main>
      )}
    </div>
  );
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
    <div className="text-right">
      <div className="font-mono text-sm font-medium">{value}</div>
      <div className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
    </div>
  );
}
