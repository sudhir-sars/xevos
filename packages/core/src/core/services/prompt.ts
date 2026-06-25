// services/prompt.service.ts
import { Agent } from "../schema/agent.schema";
import { PromptRepository } from "../../repositories/prompt";
import { AgentRepository } from "../../repositories";
import { ServiceId } from "../schema";

export const promptServiceId: ServiceId = "service_prompts";

export class PromptService {
  constructor(
    private readonly prompts: PromptRepository,
    private readonly agents: AgentRepository,
  ) {}

  buildSystemPrompt(agent: Agent): string {
    const { departmentPrompt, rolePrompt } = this.prompts.getAgentPrompt(
      agent.role,
      agent.department,
    );

    const sections: string[] = [];

    sections.push(["[Role Instructions]", rolePrompt].join("\n"));

    sections.push(["[Department Instructions]", departmentPrompt].join("\n"));

    sections.push(
      [
        "[Agent Profile]",
        `Id: ${agent.id}`,
        `Role: ${agent.role}`,
        `Department: ${agent.department}`,
      ].join("\n"),
    );

    sections.push(["[Objective]", agent.objective].join("\n"));

    if (agent.responsibilities.length > 0) {
      sections.push(
        [
          "[Responsibilities]",
          ...agent.responsibilities.map((item) => `- ${item}`),
        ].join("\n"),
      );
    }

    if (agent.kpis.length > 0) {
      sections.push(
        ["KPIs", ...agent.kpis.map((item) => `- ${item}`)].join("\n"),
      );
    }

    if (agent.reportsTo) {
      sections.push(
        ["Reporting Structure", `You report to ${agent.reportsTo}.`].join("\n"),
      );
    }

    if (agent.manages.length > 0) {
      sections.push(
        [
          "[Management Responsibilities]",
          `You manage ${agent.manages.map((agentId) => this.agents.get(agentId).id).join("\n")} agents.`,
        ].join("\n"),
      );
    }

    if (agent.tools.length > 0) {
      sections.push(
        ["Available Tools", ...agent.tools.map((tool) => `- ${tool}`)].join(
          "\n",
        ),
      );
    }

    return sections.join("\n\n");
  }
}
