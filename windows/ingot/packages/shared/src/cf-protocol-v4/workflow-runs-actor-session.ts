// ============================================================
// ============================================================
//

import type { WorkflowRunActor } from "./workflow-runs.js";
import { boundedSessionId } from "./workflow-runs-entries.js";

interface ActorRef {
  siteId: string;
  ordinal: number;
}

export function actorsWithTranscriptSession(
  actors: WorkflowRunActor[],
  eventType: string,
  payload: Record<string, unknown>,
  actorRef: ActorRef | null,
  envelopeSessionId: string | undefined,
): WorkflowRunActor[] {
  if (actorRef === null) return actors;
  const sessionId =
    eventType === "node-settled" && payload.cached === true
      ? (boundedSessionId(payload.sourceSessionId) ?? boundedSessionId(envelopeSessionId))
      : eventType === "node-dispatched"
        ? boundedSessionId(envelopeSessionId)
        : undefined;
  if (sessionId === undefined) return actors;
  const index = actors.findIndex(
    (actor) => actor.siteId === actorRef.siteId && actor.ordinal === actorRef.ordinal,
  );
  if (index < 0 || actors[index]!.sessionId === sessionId) return actors;
  const next = actors.slice();
  next[index] = { ...actors[index]!, sessionId };
  return next;
}
