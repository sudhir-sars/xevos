import { generateText, ModelMessage, Output, SystemModelMessage } from "ai";
import { BM25 } from "fast-bm25";
import { z } from "zod";
import type {
  Agent,
  Event,
  MemoryWarehouse,
  ClosedReason,
  TaskId,
} from "../schema";

import { TaskRepository } from "../../repositories/task.repository";
import {
  AgentMemoryRepository,
  MemoryWarehouseRepository,
} from "../../repositories";

const learningSchema = z.object({
  summary: z.string(),
  keyFindings: z.array(z.string()),
  decisions: z.array(z.string()),
  lessonsLearned: z.array(z.string()),
});

export type Learning = z.infer<typeof learningSchema>;

const WAREHOUSE_CONTEXT_ID = "warehouse-context";
const WAREHOUSE_CONTEXT_LIMIT = 5;

export class MemoryService {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly agentMemoryRepository: AgentMemoryRepository,
    private readonly warehouseRepository: MemoryWarehouseRepository,
  ) {}

  async assembleContext(agent: Agent, event: Event): Promise<ModelMessage[]> {
    const [memory, warehouseEntries] = await Promise.all([
      this.agentMemoryRepository.get(agent.id),
      this.warehouseRepository.list(),
    ]);

    const messages = [...(memory?.messages ?? [])];

    const hasWarehouseContext = messages.some(
      (message) =>
        message.role === "system" &&
        "id" in message &&
        message.id === WAREHOUSE_CONTEXT_ID,
    );

    if (!hasWarehouseContext) {
      const query = this.buildSearchQuery(event);

      if (query) {
        const relevantMemories = this.search(warehouseEntries, query);

        const warehouseMessage: SystemModelMessage & { id: string } = {
          id: WAREHOUSE_CONTEXT_ID,
          role: "system",
          content: `Warehouse Context:\n${JSON.stringify(relevantMemories, null, 2)}`,
        };

        messages.unshift(warehouseMessage);
      }
    }

    return messages;
  }

  private buildSearchQuery(event: Event): string | null {
    switch (event.topic) {
      case "task":
        switch (event.type) {
          case "task_create_request":
            return `${event.body.title} ${event.body.description ?? ""}`.trim();
          case "task_delegation_request":
            return `task delegation ${event.body.taskId}`;
          case "task_update_request":
            return `task update ${event.body.taskId} ${JSON.stringify(event.body.patch)}`;
          case "task_transition_request":
            return `task ${event.body.taskId} transition to ${event.body.to}`;
          default:
            return null; // response events — no need to search
        }

      case "agent":
        switch (event.type) {
          case "information_request":
            return event.body.query;
          case "escalation_request":
            return event.body.reason;
          case "approval_request":
            return `${event.body.action} ${event.body.reason}`;
          case "review_presentation_request":
            return event.body.summary;
          default:
            return null; // response events, lifecycle events — no useful query
        }
    }
  }

  async recordTurn(agent: Agent, messages: ModelMessage[]): Promise<void> {
    await this.agentMemoryRepository.append(agent.id, messages);
  }

  async closeTask(
    agent: Agent,
    taskId: TaskId,
    closedReason: ClosedReason,
    summary?: string,
  ): Promise<void> {
    const [memory, task] = await Promise.all([
      this.agentMemoryRepository.get(agent.id),
      this.taskRepository.get(taskId),
    ]);

    if (!task) throw new Error(`Task not found: ${taskId}`);

    const messages = memory?.messages ?? [];
    const transcript = this.buildTranscript(
      task,
      closedReason,
      summary,
      messages,
    );

    const learning = await this.extractLearning(transcript);

    await Promise.all([
      this.agentMemoryRepository.clear(agent.id),
      this.warehouseRepository.archive({
        taskId,
        agentId: agent.id,
        outcome: closedReason,
        learning,
        messages,
      }),
    ]);
  }

  async extractLearning(transcript: string): Promise<Learning> {
    const { output } = await generateText({
      model: "google/gemini-3.5-flash",
      system: `
You are an autonomous agent memory system.

Analyze a completed task and extract durable learnings.

Focus on:
- key findings
- decisions made
- lessons learned
- useful future context

Ignore conversational filler.
`,
      prompt: transcript,
      output: Output.object({ schema: learningSchema }),
    });

    return output;
  }

  private search(
    entries: MemoryWarehouse[],
    query: string,
    limit = WAREHOUSE_CONTEXT_LIMIT,
  ): MemoryWarehouse[] {
    if (entries.length === 0) return [];

    const docs = entries.map((entry) => ({
      summary: entry.learning.summary,
      findings: entry.learning.keyFindings.join(" "),
      decisions: entry.learning.decisions.join(" "),
      lessons: entry.learning.lessonsLearned.join(" "),
    }));

    const bm25 = new BM25(docs, {
      fieldBoosts: {
        summary: 2,
        findings: 1.5,
        decisions: 1,
        lessons: 1,
      },
    });

    return bm25
      .search(query, limit)
      .map(({ index }: { index: number }) => entries[index]);
  }

  private buildTranscript(
    task: Awaited<ReturnType<TaskRepository["get"]>> & {},
    closedReason: ClosedReason,
    summary: string | undefined,
    messages: ModelMessage[],
  ): string {
    const messageLog = messages
      .map((message) => {
        const content =
          typeof message.content === "string"
            ? message.content
            : message.content
                .map((part) => {
                  switch (part.type) {
                    case "text":
                      return part.text;
                    case "reasoning":
                      return `[REASONING] ${part.text}`;
                    case "tool-call":
                      return `[TOOL_CALL] ${part.toolName}`;
                    case "tool-result":
                      return `[TOOL_RESULT] ${JSON.stringify(part.output)}`;
                    default:
                      return "";
                  }
                })
                .filter(Boolean)
                .join("\n");

        return `[${message.role}]\n${content}`;
      })
      .join("\n\n");

    return `
[TASK]
Id: ${task.id}
Title: ${task.title}
Description: ${task.description}
Priority: ${task.priority}
Status: ${task.status}

Acceptance Criteria:
${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}

Dependencies:
${task.dependencies.join(", ") || "None"}

Assigned To:
${task.assignedTo ?? "Unassigned"}

Closed Reason:
${closedReason}

Provided Summary:
${summary ?? "None"}

[TRANSCRIPT]

${messageLog}
`.trim();
  }
}
