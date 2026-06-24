import { sendMessage } from "./send-message";
import { requestInformation } from "./request-information";
import { escalateBlocker } from "./escalate-blocker";
import { requestReview } from "./request-review";
import { createSubordinateAgent } from "./create-subordinate-agent";
import { searchMemory } from "./search-memory";
import { getStatus } from "./get-status";
import { respondToPrincipal } from "./respond-to-principal";
import { waitUntilResponse } from "./wait-until-response";
import { webSearch } from "./web-search";
import { assignTask } from "./assign-task";

/** Communication, coordination, and organization tools. */
export const agentDefinitions = [
  assignTask,
  sendMessage,
  requestInformation,
  escalateBlocker,
  requestReview,
  createSubordinateAgent,
  searchMemory,
  getStatus,
  respondToPrincipal,
  waitUntilResponse,
  webSearch,
] as const;
