export { BrowserSession, type BrowserSessionOptions } from "./browser/session";
export {
  OBSCURA_CDP_URL,
  SESSIONS_DIR,
  DEFAULT_TIMEOUT_MS,
} from "./browser/config";
export { FileSessionStore, type SessionStore } from "./storage/sessions";

export type {
  PlatformAction,
  PlatformConnector,
  PlatformWatcher,
  WatchResult,
} from "./connectors/types";

export {
  TwitterConnector,
  type PostInput,
  type ReplyInput,
  type PostResult,
  type Mention,
} from "./connectors/twitter/twitter";
export { X as twitterSelectors } from "./connectors/twitter/selectors";
