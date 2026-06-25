import type { AgentId, AgentCreate } from "../agent.schema";
import { TaskId } from "../task.schema";
import { BaseEvent } from "./base-event";

export interface TaskDelegationRequestEvent extends BaseEvent {
  topic: "agent";
  type: "task_delegation_request";

  body: {
    taskId: TaskId;
  };
}

export interface TaskDelegationResponseEvent extends BaseEvent {
  topic: "agent";
  type: "task_delegation_response";

  body: {
    taskId: TaskId;
    accepted: boolean;
    reason: string | null;
  };
}

export interface ApprovalRequestEvent extends BaseEvent {
  topic: "agent";
  type: "approval_request";

  body: {
    action: string;
    reason: string;
  };
}

export interface ApprovalResponseEvent extends BaseEvent {
  topic: "agent";
  type: "approval_response";

  body: {
    approved: boolean;
    reason: string | null;
  };
}

export interface InformationRequestEvent extends BaseEvent {
  topic: "agent";
  type: "information_request";

  body: {
    query: string;
  };
}

export interface InformationResponseEvent extends BaseEvent {
  topic: "agent";
  type: "information_response";

  body: {
    answer: string;
  };
}

export interface EscalationRequestEvent extends BaseEvent {
  topic: "agent";
  type: "escalation_request";

  body: {
    reason: string;
    blockedTaskId: TaskId | null;
  };
}

export interface EscalationResponseEvent extends BaseEvent {
  topic: "agent";
  type: "escalation_response";

  body: {
    solution: string;
    blockedTaskId: TaskId | null;
  };
}

export interface ReviewPresentationRequestEvent extends BaseEvent {
  topic: "agent";
  type: "review_presentation_request";

  body: {
    summary: string;
    taskId: TaskId | null;
  };
}

export interface ReviewPresentationResponseEvent extends BaseEvent {
  topic: "agent";
  type: "review_presentation_response";

  body: {
    summary: string;
    taskId: TaskId | null;
  };
}

export interface AgentMessageEvent extends BaseEvent {
  topic: "agent";
  type: "message";

  body: {
    content: string;
  };
}

export interface AgentCreationRequestEvent extends BaseEvent {
  topic: "agent";
  type: "agent_creation_request";

  body: AgentCreate;
}

export interface AgentCreationResponseEvent extends BaseEvent {
  topic: "agent";
  type: "agent_creation_response";

  body: {
    approved: boolean;
    agentId: AgentId | null;
    reason: string | null;
  };
}

export interface AgentSuspensionRequestEvent extends BaseEvent {
  topic: "agent";
  type: "agent_suspension_request";

  body: {
    agentId: AgentId;
    reason: string;
  };
}

export interface AgentSuspensionResponseEvent extends BaseEvent {
  topic: "agent";
  type: "agent_suspension_response";

  body: {
    approved: boolean;
    reason: string | null;
  };
}

export interface AgentResumeRequestEvent extends BaseEvent {
  topic: "agent";
  type: "agent_resume_request";

  body: {
    agentId: AgentId;
  };
}

export interface AgentResumeResponseEvent extends BaseEvent {
  topic: "agent";
  type: "agent_resume_response";

  body: {
    resumed: boolean;
    reason: string | null;
  };
}

export interface AgentTerminationRequestEvent extends BaseEvent {
  topic: "agent";
  type: "agent_termination_request";

  body: {
    agentId: AgentId;
    reason: string;
  };
}

export interface AgentTerminationResponseEvent extends BaseEvent {
  topic: "agent";
  type: "agent_termination_response";

  body: {
    terminated: boolean;
    reason: string | null;
  };
}

export type AgentEvent =
  | TaskDelegationRequestEvent
  | TaskDelegationResponseEvent
  | ApprovalRequestEvent
  | ApprovalResponseEvent
  | InformationRequestEvent
  | InformationResponseEvent
  | EscalationRequestEvent
  | EscalationResponseEvent
  | ReviewPresentationRequestEvent
  | ReviewPresentationResponseEvent
  | AgentMessageEvent
  | AgentCreationRequestEvent
  | AgentCreationResponseEvent
  | AgentSuspensionRequestEvent
  | AgentSuspensionResponseEvent
  | AgentResumeRequestEvent
  | AgentResumeResponseEvent
  | AgentTerminationRequestEvent
  | AgentTerminationResponseEvent;
