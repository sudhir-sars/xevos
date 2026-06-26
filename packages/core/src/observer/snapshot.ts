import type { AgentRepository, PromptRepository } from "../repositories";

/** The SQLite-backed stores the observer reads org state from. */
export interface SnapshotSources {
  agents: AgentRepository;
  prompts: PromptRepository;
}
