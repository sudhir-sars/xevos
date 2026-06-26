/**
 * x.com DOM hooks, centralized because they are BRITTLE and x.com changes them.
 * `data-testid` attributes are the most stable handles x.com exposes. When the
 * Twitter automation breaks, fix the selectors HERE — nothing else should hard-
 * code an x.com selector.
 */
export const X = {
  base: "https://x.com",
  composeUrl: "https://x.com/compose/post",
  mentionsUrl: "https://x.com/notifications/mentions",
  messagesUrl: "https://x.com/messages",

  // Composer
  tweetEditor: '[data-testid^="tweetTextarea_0"]',
  tweetButton: '[data-testid="tweetButton"]',
  replyButton: '[data-testid="reply"]',

  // A rendered tweet and the link that carries its status id
  tweetArticle: 'article[data-testid="tweet"]',
  statusLink: 'a[href*="/status/"]',

  // Logged-out signals
  loginGate: '[data-testid="loginButton"], a[href="/login"], a[href="/i/flow/login"]',
  // Positive logged-in signal (more reliable than gate-absence)
  loggedInSignal:
    '[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Home_Link"], [data-testid="primaryColumn"]',
  loginUrl: "https://x.com/i/flow/login",
} as const;

/** Extract the numeric status id from a /status/<id> permalink href. */
export function statusIdFromHref(href: string): string | null {
  const m = href.match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}
