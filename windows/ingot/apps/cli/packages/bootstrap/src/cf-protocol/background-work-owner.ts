import type { SessionId, SessionInfo } from "@origin-ai/cf-contracts";
import type { BackgroundBashOutputResult } from "@origin-ai/cf-shared";
import type { CfProtocolAgentServerContext } from "./server-types.js";

export async function readBackgroundBashOutputFromOwner(
  context: CfProtocolAgentServerContext,
  sessionId: string,
  workId: string,
): Promise<BackgroundBashOutputResult> {
  const visited = new Set<string>();
  let current: string | undefined = sessionId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const live = context.sessions.get(current);
    if (live) {
      const result = await live.app.readBackgroundBashOutput(workId, sessionId);
      if (result.kind !== "unavailable") return result;
    }
    const stored: SessionInfo | null | undefined = await context.deps.sessionStore?.getSession(
      current as SessionId,
    );
    current = stored?.parentID ? String(stored.parentID) : undefined;
  }
  return { kind: "unavailable", workId };
}
