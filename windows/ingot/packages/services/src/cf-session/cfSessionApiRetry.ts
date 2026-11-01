import {
  normalizeCfApiRetryStatus,
  isCfModelRetryRecoveryProgressPayload,
  resolveWorkspaceKey,
  type CfSessionApiRetryStatus,
  type CfSessionStateSnapshot,
  cfApiRetryFromModelNetworkStatusPayload,
  cfApiRetryFromStreamRecoveryPayload,
} from "@origin-ai/cf-shared";
import type { CfSessionServiceEvent, CfTaskTarget } from "#src/cf-session/cfSession.js";

export function createCfSessionApiRetryRuntimeTracker(): {
  trackApiRetryFromSessionEvent: (
    params: CfTaskTarget,
    event: CfSessionServiceEvent,
  ) => CfSessionServiceEvent;
  withApiRetryRuntime: (snapshot: CfSessionStateSnapshot) => CfSessionStateSnapshot;
} {
  const apiRetryBySessionKey = new Map<string, CfSessionApiRetryStatus | null>();

  function trackApiRetryFromSessionEvent(
    params: CfTaskTarget,
    event: CfSessionServiceEvent,
  ): CfSessionServiceEvent {
    if (
      event.type === "session.event" &&
      (event.event.type === "session.updated" || event.event.type === "streamRecovery.updated")
    ) {
      const apiRetry = apiRetryFromSessionPayload(asRecord(event.event.payload));
      const key = sessionKey({
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
        sessionId: event.event.sessionId,
      });
      if (apiRetry !== undefined) {
        apiRetryBySessionKey.set(key, apiRetry);
      } else if (
        apiRetryBySessionKey.get(key) != null &&
        isCfModelRetryRecoveryProgressPayload(asRecord(event.event.payload))
      ) {
        apiRetryBySessionKey.set(key, null);
      }
      return event;
    }
    if (event.type === "snapshot") {
      return {
        ...event,
        snapshot: withApiRetryRuntime(event.snapshot),
      };
    }
    return event;
  }

  function withApiRetryRuntime(snapshot: CfSessionStateSnapshot): CfSessionStateSnapshot {
    const sessionId = snapshot.session?.sessionId;
    const workspacePath = snapshot.session?.workspace?.workspacePath;
    if (!sessionId || !workspacePath) {
      return snapshot;
    }
    const key = sessionKey({
      workspacePath,
      workspaceIdentity: snapshot.session.workspace.workspaceIdentity,
      sessionId,
    });
    if (snapshot.runtime?.apiRetry !== undefined) {
      apiRetryBySessionKey.set(key, snapshot.runtime.apiRetry);
      return snapshot;
    }
    if (snapshot.session.status === "completed" || snapshot.session.status === "error") {
      apiRetryBySessionKey.set(key, null);
      return {
        ...snapshot,
        runtime: {
          ...snapshot.runtime,
          apiRetry: null,
        },
      };
    }
    if (!apiRetryBySessionKey.has(key)) {
      return snapshot;
    }
    return {
      ...snapshot,
      runtime: {
        ...snapshot.runtime,
        apiRetry: apiRetryBySessionKey.get(key) ?? null,
      },
    };
  }

  function sessionKey(params: CfTaskTarget): string {
    return `${resolveWorkspaceKey(params)}\u0000${params.sessionId}`;
  }

  return {
    trackApiRetryFromSessionEvent,
    withApiRetryRuntime,
  };
}

function apiRetryFromSessionPayload(
  payload: Record<string, unknown>,
): CfSessionApiRetryStatus | null | undefined {
  if ("apiRetry" in payload) {
    return normalizeCfApiRetryStatus(payload.apiRetry);
  }
  const runtimeRetry = normalizeCfApiRetryStatus(asRecord(payload.runtime).apiRetry);
  if (runtimeRetry !== undefined) {
    return runtimeRetry;
  }
  const metaRetry = normalizeCfApiRetryStatus(asRecord(asRecord(payload._meta).cf).apiRetry);
  if (metaRetry !== undefined) {
    return metaRetry;
  }
  return (
    cfApiRetryFromStreamRecoveryPayload(payload) ??
    cfApiRetryFromModelNetworkStatusPayload(payload)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
