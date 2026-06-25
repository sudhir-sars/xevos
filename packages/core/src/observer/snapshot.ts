import type {
  AgentRepository,
  MemoryWarehouseRepository,
  PromptRepository,
  TaskRepository,
} from "../repositories";

import { PROTOCOL_VERSION, type Snapshot } from "./protocol";

/** The lowdb-backed stores the snapshot is assembled from. */
export interface SnapshotSources {
  agents: AgentRepository;
  tasks: TaskRepository;
  prompts: PromptRepository;
  memoryWarehouse: MemoryWarehouseRepository;
}

export interface SnapshotMeta {
  capturedAt: number;
  throughSeq: number;
}

/**
 * Build a full snapshot from the live repositories. `throughSeq` should be the
 * bus's `publishedCount` captured *before* this call so the snapshot is
 * guaranteed not to omit any event the client will later receive incrementally.
 */
export async function buildSnapshot(
  sources: SnapshotSources,
  meta: SnapshotMeta,
): Promise<Snapshot> {
  const [tasks, memoryWarehouse] = await Promise.all([
    sources.tasks.list(),
    sources.memoryWarehouse.list(),
  ]);

  return {
    protocolVersion: PROTOCOL_VERSION,
    capturedAt: meta.capturedAt,
    throughSeq: meta.throughSeq,
    agents: sources.agents.list(),
    tasks,
    prompts: sources.prompts.all(),
    memoryWarehouse,
  };
}
