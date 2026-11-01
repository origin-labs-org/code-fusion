import type { BrowserViewCloseTabNotification } from "@origin-ai/cf-shared";
import type { BrowserGuestExecutionContext } from "./browserGuestManager.js";

export type BrowserCloseTabNotificationOwner = Pick<
  BrowserGuestExecutionContext,
  "workspaceKey" | "sessionId" | "remoteSessionId"
>;

export function buildBrowserViewCloseTabNotification(
  tabId: string,
  owner?: BrowserCloseTabNotificationOwner,
): BrowserViewCloseTabNotification {
  if (!owner) return { tabId };
  return {
    tabId,
    workspaceKey: owner.workspaceKey,
    sessionId: owner.sessionId,
    ...(owner.remoteSessionId ? { remoteSessionId: owner.remoteSessionId } : {}),
  };
}
