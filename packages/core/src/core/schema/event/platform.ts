import type { BaseEvent } from "./base-event";

/** The kind of inbound activity a connector's watcher surfaced. */
export type PlatformInboundKind =
  | "mention"
  | "reply"
  | "comment"
  | "dm"
  | "follower";

/**
 * A synthetic webhook: a connector's poller detected new activity on a stubborn
 * platform (which has no real webhook) and pushes it onto the bus. From here it
 * fans out exactly like any event — to the observer (dashboard) and into the
 * target's inbox for an agent to react to.
 */
export interface PlatformInboundEvent extends BaseEvent {
  topic: "platform";
  type: "platform_inbound";
  body: {
    platform: string; // "twitter"
    account: string; // the connected account handle
    kind: PlatformInboundKind;
    /** The scraped item (Mention, Reply, DM, …) — shape is connector-specific. */
    item: unknown;
  };
}

/**
 * The connected session went stale (logout/expiry). Surfaced as an escalation
 * so re-login is the rare human-in-the-loop moment, not a silent failure.
 */
export interface PlatformSessionExpiredEvent extends BaseEvent {
  topic: "platform";
  type: "platform_session_expired";
  body: {
    platform: string;
    account: string;
    reason?: string;
  };
}

export type PlatformEvent = PlatformInboundEvent | PlatformSessionExpiredEvent;
