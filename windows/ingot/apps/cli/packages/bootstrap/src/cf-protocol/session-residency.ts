
import type { SessionId } from "@origin-ai/cf-contracts";
import type {
  SessionDeactivationDecision,
  SessionResidentPoolHost,
} from "./session-resident-pool.js";
import type { CfProtocolAgentServerContext } from "./server-types.js";

export {
  acquireSessionResidencyFinalization,
  runWithSessionResidencyFinalization,
  type SessionResidencyFinalizationOwner,
} from "../session-execution/index.js";

export async function deactivateSessionRecord(
  context: CfProtocolAgentServerContext,
  sessionId: string,
): Promise<void> {
  const record = context.sessions.get(sessionId);
  if (!record) return;
  context.v4Gateway?.assertSessionRuntimeDeactivatable(sessionId);
  record.unsubscribe?.();
  context.v4Gateway?.deactivateSession(sessionId);
  context.sessions.delete(sessionId);
  await record.app.close?.();
  await record.eventStore.deleteSession(sessionId as SessionId);
}

export function createSessionResidentPoolHost(
  context: CfProtocolAgentServerContext,
): SessionResidentPoolHost {
  return {
    deactivate: (sessionId) => deactivateSessionRecord(context, sessionId),
    listSessionIds: () => [...context.sessions.keys()],
    readResidencyFacts: (sessionId) => {
      const record = context.sessions.get(sessionId);
      if (!record) return null;
      return {
        hasPendingInteractions: context.v4Interactions.hasPendingForSession(sessionId),
        hasQueuedCommands: context.v4Gateway?.hasResidencyBlockingCommands(sessionId) ?? false,
        hasLegacySubscriber: record.legacyStreamSubscribed === true,
        hasResidencyBlockingWork:
          record.activeAbortController !== undefined ||
          (record.residencyFinalizationCount ?? 0) > 0 ||
          record.app.runtime.hasResidencyBlockingWork(),
        hasSubscribers: context.v4Gateway?.hasConversationSubscribers(sessionId) ?? false,
        lastActivityAt: record.updatedAt,
        persisted: record.persistence === "immediate",
      };
    },
    onDeactivated: (sessionId, decision) => {
      context.logger?.info("Session resident runtime deactivated", {
        ...deactivationLogContext(decision),
        event: "cf_protocol.session.resident_deactivated",
        sessionId,
      });
    },
    onError: (sessionId, error, decision) => {
      context.logger?.warn("Session resident deactivation failed", {
        ...deactivationLogContext(decision),
        error: error instanceof Error ? error.message : String(error),
        event: "cf_protocol.session.resident_deactivation_failed",
        sessionId,
      });
    },
  };
}

function deactivationLogContext(
  decision: SessionDeactivationDecision,
): Record<string, number | string> {
  return {
    highWaterCount: decision.highWaterCount,
    idleMs: decision.idleMs,
    idleTimeoutMs: decision.idleTimeoutMs,
    reason: decision.reason,
    residentCountBefore: decision.residentCountBefore,
    targetCount: decision.targetCount,
  };
}
