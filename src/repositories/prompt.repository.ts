import { JSONFilePreset } from "lowdb/node";
import { Department, Role } from "../core/schema";

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
    const db = await JSONFilePreset<PromptDatabase>(file, {
      roles: {},
      departments: {},
    });

    return new PromptRepository(db);
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
