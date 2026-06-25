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

    sections.push(
      [
        "[How coordination works]",
        "You are one agent in an asynchronous, event-driven organization. You never call other agents or services directly — you act through tools, and most tools are COMMANDS published to a shared event bus.",
        "- When you call a coordination tool (create_task, assign_task, create_subordinate_agent, request_information, escalate_blocker, request_review, update_task_status, send_message), it returns only an ACKNOWLEDGEMENT — an object like { status: \"accepted\", eventId, awaiting, note }. This confirms the command was queued; it is NOT the result.",
        '- The returned eventId is a correlation handle, NOT a taskId, agentId, or answer. When the command has a result, it arrives LATER as a separate event delivered to you (e.g. task_create_response carries the real taskId; agent_creation_response carries the real agentId; information_response carries the answer), labelled "in reply to your command <eventId>".',
        "- NEVER invent, guess, or reuse an id you have not received in a response event. Do not assign a task until its task_create_response has given you the real taskId; do not message or delegate to a subordinate until its agent_creation_response has given you the real agentId.",
        "- You take exactly one action per turn and then wait. After issuing a command whose result you need next, do not take a dependent action — call wait_until_response. The matching response event will wake you, and you continue from there.",
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
