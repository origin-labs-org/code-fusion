import { parseConversationShareRoute } from "./conversationSharePreviewClient.js";

export function resolveConversationShareCodeFromPath(pathname: string): string | null {
  return parseConversationShareRoute(pathname);
}

export function isConversationSharePath(pathname: string): boolean {
  return (
    pathname === "/cn/share" ||
    pathname.startsWith("/cn/share/") ||
    pathname === "/share" ||
    pathname.startsWith("/share/")
  );
}
