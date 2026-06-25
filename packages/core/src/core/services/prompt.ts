// services/prompt.service.ts
import { Agent } from "../schema/agent.schema";
import { PromptRepository } from "../../repositories/prompt";
import { AgentRepository } from "../../repositories";
import { ServiceId } from "../schema";

export const promptServiceId: ServiceId = "prompts_service";

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

    sections.push(
      [
        "[How coordination works]",
        "You are one agent in an asynchronous, event-driven organization. You act only through tools, and tools come in two kinds — know which you are calling:",
        "- DIRECT tools (create_subordinate_agent, create_and_assign_task, update_task_status, and all coding tools) run immediately and return the REAL result in the SAME step: create_subordinate_agent returns the new agent's id, create_and_assign_task returns the new taskId. Read that result and act on it right away — do NOT call wait_until_response after a direct tool, and do NOT expect a separate response event for it.",
        '- BUS tools (send_message, request_information, request_review, escalate_blocker) are messages to other agents or services. They return only an ACKNOWLEDGEMENT ({ status: "accepted", eventId, … }), never the result. If a reply is expected it arrives LATER as its own event addressed to you, labelled "in reply to your command <eventId>" (e.g. information_response carries the answer). After a bus command whose reply you need next, call wait_until_response and the reply will wake you.',
        "- NEVER invent or guess an id. For a direct tool you already hold the real id it just returned; for a bus tool, wait for the response event before using anything it will carry.",
      ].join("\n"),
    );

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
