import { eq } from "drizzle-orm";

import {
  Department,
  Role,
  departmentSchema,
  roleSchema,
} from "../../core/schema";
import { getDb, type DB } from "../../db/client";
import { prompts } from "../../db/schema";
import { DEPARTMENT_PROMPTS, ROLE_PROMPTS } from "./default-prompts";

const roleKey = (role: Role): string => `role:${role}`;
const departmentKey = (department: Department): string =>
  `department:${department}`;

export class PromptRepository {
  // Prompts rarely change and are read on every turn, so they are cached in
  // memory and kept in sync with the DB on save (preserving the sync getters).
  private readonly roles = new Map<Role, string>();
  private readonly departments = new Map<Department, string>();

  constructor(private readonly db: DB) {}

  static async create(): Promise<PromptRepository> {
    const repository = new PromptRepository(getDb());
    repository.seedDefaults();
    repository.loadCache();
    return repository;
  }

  private seedDefaults(): void {
    const rows: { key: string; content: string; updatedAt: number }[] = [];
    const now = Date.now();

    for (const role of roleSchema.options) {
      rows.push({ key: roleKey(role), content: ROLE_PROMPTS[role], updatedAt: now });
    }
    for (const department of departmentSchema.options) {
      rows.push({
        key: departmentKey(department),
        content: DEPARTMENT_PROMPTS[department],
        updatedAt: now,
      });
    }

    // Insert defaults only where absent; never clobber edited prompts.
    for (const row of rows) {
      this.db.insert(prompts).values(row).onConflictDoNothing().run();
    }
  }

  private loadCache(): void {
    for (const row of this.db.select().from(prompts).all()) {
      if (row.key.startsWith("role:")) {
        this.roles.set(row.key.slice("role:".length) as Role, row.content);
      } else if (row.key.startsWith("department:")) {
        this.departments.set(
          row.key.slice("department:".length) as Department,
          row.content,
        );
      }
    }
  }

  private upsert(key: string, content: string): void {
    this.db
      .insert(prompts)
      .values({ key, content, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: prompts.key,
        set: { content, updatedAt: Date.now() },
      })
      .run();
  }

  /** Snapshot of all role and department prompts (defensive copies). */
  all(): {
    roles: Partial<Record<Role, string>>;
    departments: Partial<Record<Department, string>>;
  } {
    return {
      roles: Object.fromEntries(this.roles),
      departments: Object.fromEntries(this.departments),
    };
  }

  getRolePrompt(role: Role): string {
    const prompt = this.roles.get(role);
    if (!prompt) throw new Error(`Role prompt not found for "${role}"`);
    return prompt;
  }

  async saveRolePrompt(role: Role, prompt: string): Promise<void> {
    this.upsert(roleKey(role), prompt);
    this.roles.set(role, prompt);
  }

  getDepartmentPrompt(department: Department): string {
    const prompt = this.departments.get(department);
    if (!prompt)
      throw new Error(`Department prompt not found for "${department}"`);
    return prompt;
  }

  async saveDepartmentPrompt(
    department: Department,
    prompt: string,
  ): Promise<void> {
    this.upsert(departmentKey(department), prompt);
    this.departments.set(department, prompt);
  }

  getAgentPrompt(
    role: Role,
    department: Department,
  ): {
    rolePrompt: string;
    departmentPrompt: string;
  } {
    return {
      rolePrompt: this.getRolePrompt(role),
      departmentPrompt: this.getDepartmentPrompt(department),
    };
  }
}
