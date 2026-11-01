export interface V4TurnCompletionSnapshot {
  canStop: boolean;
  sessionId: string | null;
  timelineText: string;
}

export function isV4TurnCompleted(
  snapshot: V4TurnCompletionSnapshot,
  expectedAssistantReply: string,
) {
  return (
    snapshot.sessionId !== null &&
    snapshot.sessionId !== "draft" &&
    !snapshot.canStop &&
    snapshot.timelineText.includes(expectedAssistantReply)
  );
}
