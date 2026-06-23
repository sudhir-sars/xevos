import type { AgentId, AgentKind, Department, Role } from "../agent.schema";
import { TaskId } from "../task.schema";
import { BaseEvent } from "./base-event";

interface TaskDelegationRequestEvent extends BaseEvent {
  topic: "agent";
  type: "task_delegation_request";

  body: {
    taskId: TaskId;
  };
}

interface TaskDelegationResponseEvent extends BaseEvent {
  topic: "agent";
  type: "task_delegation_response";

  body: {
    taskId: TaskId;
    accepted: boolean;
    reason: string | null;
  };
}

interface ApprovalRequestEvent extends BaseEvent {
  topic: "agent";
  type: "approval_request";

  body: {
    action: string;
    reason: string;
  };
}

interface ApprovalResponseEvent extends BaseEvent {
  topic: "agent";
  type: "approval_response";

  body: {
    approved: boolean;
    reason: string | null;
  };
}

interface InformationRequestEvent extends BaseEvent {
  topic: "agent";
  type: "information_request";

  body: {
    query: string;
  };
}

interface InformationResponseEvent extends BaseEvent {
  topic: "agent";
  type: "information_response";

  body: {
    answer: string;
  };
}

interface EscalationRequestEvent extends BaseEvent {
  topic: "agent";
  type: "escalation_request";

  body: {
    reason: string;
    blockedTaskId: TaskId | null;
  };
}

interface EscalationResponseEvent extends BaseEvent {
  topic: "agent";
  type: "escalation_response";

  body: {
    solution: string;
    blockedTaskId: TaskId | null;
  };
}

interface ReviewPresentationRequestEvent extends BaseEvent {
  topic: "agent";
  type: "review_presentation_request";

  body: {
    summary: string;
    taskId: TaskId | null;
  };
}

interface ReviewPresentationResponseEvent extends BaseEvent {
  topic: "agent";
  type: "review_presentation_response";

  body: {
    summary: string;
    taskId: TaskId | null;
  };
}

interface AgentMessageEvent extends BaseEvent {
  topic: "agent";
  type: "message";

  body: {
    content: string;
  };
}

interface AgentCreationRequestEvent extends BaseEvent {
  topic: "agent";
  type: "agent_creation_request";

  body: {
    role: Role;
    department: Department;
    kind: AgentKind;

    objective: string;
    reason: string;
  };
}

interface AgentCreationResponseEvent extends BaseEvent {
  topic: "agent";
  type: "agent_creation_response";

  body: {
    approved: boolean;
    agentId: AgentId | null;
    reason: string | null;
  };
}

interface AgentSuspensionRequestEvent extends BaseEvent {
  topic: "agent";
  type: "agent_suspension_request";

  body: {
    agentId: AgentId;
    reason: string;
  };
}

interface AgentSuspensionResponseEvent extends BaseEvent {
  topic: "agent";
  type: "agent_suspension_response";

  body: {
    approved: boolean;
    reason: string | null;
  };
}

interface AgentResumeRequestEvent extends BaseEvent {
  topic: "agent";
  type: "agent_resume_request";

  body: {
    agentId: AgentId;
  };
}

interface AgentResumeResponseEvent extends BaseEvent {
  topic: "agent";
  type: "agent_resume_response";

  body: {
    resumed: boolean;
    reason: string | null;
  };
}

interface AgentTerminationRequestEvent extends BaseEvent {
  topic: "agent";
  type: "agent_termination_request";

  body: {
    agentId: AgentId;
    reason: string;
  };
}

interface AgentTerminationResponseEvent extends BaseEvent {
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
  | AgentCreationRequestEvent
  | AgentCreationResponseEvent
  | AgentSuspensionRequestEvent
  | AgentSuspensionResponseEvent
  | AgentResumeRequestEvent
  | AgentResumeResponseEvent
  | AgentTerminationRequestEvent
  | AgentTerminationResponseEvent;
