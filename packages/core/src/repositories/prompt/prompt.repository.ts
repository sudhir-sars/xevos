import { JSONFilePreset } from "lowdb/node";
import {
  Department,
  Role,
  departmentSchema,
  roleSchema,
} from "../../core/schema";
import { DEPARTMENT_PROMPTS, ROLE_PROMPTS } from "./default-prompts";
import { ensureStorageFile } from "../utils";

type PromptDatabase = {
  roles: Partial<Record<Role, string>>;
  departments: Partial<Record<Department, string>>;
};

type PromptDb = Awaited<ReturnType<typeof JSONFilePreset<PromptDatabase>>>;

export class PromptRepository {
  constructor(private readonly db: PromptDb) {}

  static async create(
    file = "./storage/prompts.json",
  ): Promise<PromptRepository> {
    const db = await JSONFilePreset<PromptDatabase>(
      await ensureStorageFile(file),
      {
        roles: {},
        departments: {},
      },
    );

    const repository = new PromptRepository(db);
    await repository.seedDefaults();

    return repository;
  }

  private async seedDefaults(): Promise<void> {
    let changed = false;

    for (const role of roleSchema.options) {
      if (this.db.data.roles[role] === undefined) {
        this.db.data.roles[role] = ROLE_PROMPTS[role];
        changed = true;
      }
    }

    for (const department of departmentSchema.options) {
      if (this.db.data.departments[department] === undefined) {
        this.db.data.departments[department] = DEPARTMENT_PROMPTS[department];
        changed = true;
      }
    }

    if (changed) {
      await this.db.write();
    }
  }

  /** Snapshot of all role and department prompts (defensive copies). */
  all(): {
    roles: Partial<Record<Role, string>>;
    departments: Partial<Record<Department, string>>;
  } {
    return {
      roles: { ...this.db.data.roles },
      departments: { ...this.db.data.departments },
    };
  }

  getRolePrompt(role: Role): string {
    const prompt = this.db.data.roles[role];

    if (!prompt) {
      throw new Error(`Role prompt not found for "${role}"`);
    }

    return prompt;
  }

  async saveRolePrompt(role: Role, prompt: string): Promise<void> {
    this.db.data.roles[role] = prompt;

    await this.db.write();
  }

  getDepartmentPrompt(department: Department): string {
    const prompt = this.db.data.departments[department];

    if (!prompt) {
      throw new Error(`Department prompt not found for "${department}"`);
    }

    return prompt;
  }

  async saveDepartmentPrompt(
    department: Department,
    prompt: string,
  ): Promise<void> {
    this.db.data.departments[department] = prompt;

    await this.db.write();
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
