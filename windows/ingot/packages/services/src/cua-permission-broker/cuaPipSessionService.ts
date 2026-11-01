import type { PipSessionEvent } from "@origin-ai/cf-cua/pip-session";
import {
  createPipSessionClient,
  type PipSessionClient,
  type PipSessionClientOptions,
} from "@origin-ai/cf-cua/pip-session/node";
import { createServiceLogger, type ServiceLogger } from "../logger/serviceLogger.js";
import type { CuaPipSessionService } from "./cuaPipSession.js";

export interface CuaPipPresentationCredentials {
  socketPath: string;
}

type PipSessionClientResolution =
  | { client: PipSessionClient; skipReason?: never }
  | {
      client: null;
      skipReason:
        | "service-disabled"
        | "service-disposed"
        | "credentials-unavailable"
        | "transport-disabled";
    };

function eventLogContext(event: PipSessionEvent): Record<string, unknown> {
  if (event.kind === "focus-changed") {
    return {
      kind: event.kind,
      revision: event.revision,
      sessionId: event.sessionId,
      sourceWindowId: event.sourceWindowId,
    };
  }
  return {
    eventId: event.eventId,
    kind: event.kind,
    sequenceNumber: event.sequenceNumber,
    sessionId: event.sessionId,
    ...(event.kind === "session-closed" ? {} : { turnId: event.turnId }),
    ...(event.kind === "turn-ended" ? { outcome: event.outcome } : {}),
  };
}

export function createCuaPipSessionService(options: {
  enabled: boolean;
  resolveCredentials: () => Promise<CuaPipPresentationCredentials | undefined>;
  createClient?: (options: PipSessionClientOptions) => PipSessionClient;
  logger?: ServiceLogger;
}): CuaPipSessionService {
  const logger = options.logger ?? createServiceLogger("cua-pip-session");
  const clientFactory = options.createClient ?? createPipSessionClient;
  let current: {
    key: string;
    client: PipSessionClient;
  } | null = null;
  let disabledTransportKey: string | null = null;
  let tail: Promise<void> = Promise.resolve();
  let disposed = false;
  
  let pendingTurnStarted: { event: PipSessionEvent; turnId: string } | null = null;
  
  let replayTimer: ReturnType<typeof setTimeout> | null = null;
  const REPLAY_RETRY_MS = 250;
  const REPLAY_DEADLINE_MS = 30_000;
  let replayDeadline = 0;

  const cancelReplayRetry = () => {
    if (replayTimer !== null) {
      clearTimeout(replayTimer);
      replayTimer = null;
    }
  };

  const getClient = async (): Promise<PipSessionClientResolution> => {
    if (!options.enabled) return { client: null, skipReason: "service-disabled" };
    if (disposed) return { client: null, skipReason: "service-disposed" };
    const credentials = await options.resolveCredentials();
    if (!credentials) return { client: null, skipReason: "credentials-unavailable" };
    const key = credentials.socketPath;
    if (disabledTransportKey === key) {
      return { client: null, skipReason: "transport-disabled" };
    }
    if (current?.key === key) return { client: current.client };
    current?.client.close();
    const client = clientFactory({
      socketPath: credentials.socketPath,
      onDiagnostic: (diagnostic) => {
        const message = `[cua-pip-session] ${diagnostic.code}: ${diagnostic.message}`;
        if (diagnostic.code === "version_mismatch") logger.warn(undefined, message);
        else logger.debug(undefined, message);
      },
    });
    current = { key, client };
    try {
      await client.connect();
      return { client };
    } catch (error) {
      if (current?.client === client) current = null;
      client.close();
      if ((error as { code?: unknown }).code === "version_mismatch") {
        disabledTransportKey = key;
      }
      throw error;
    }
  };

  
  const scheduleReplayRetry = (): void => {
    cancelReplayRetry();
    if (disposed || pendingTurnStarted === null) return;
    if (Date.now() >= replayDeadline) {
      logger.warn(undefined, "[cua-pip-session] deferred turn-started expired before transport", {
        ...eventLogContext(pendingTurnStarted.event),
      });
      pendingTurnStarted = null;
      return;
    }
    replayTimer = setTimeout(() => {
      replayTimer = null;
      if (disposed || pendingTurnStarted === null) return;
      const operation = tail.then(async () => {
        if (disposed || pendingTurnStarted === null) return;
        let resolution;
        try {
          resolution = await getClient();
        } catch {
          scheduleReplayRetry();
          return;
        }
        if (!resolution.client) {
          scheduleReplayRetry();
          return;
        }
        const replay = pendingTurnStarted;
        pendingTurnStarted = null;
        try {
          const result = await resolution.client.send(replay.event);
          logger.info(undefined, "[cua-pip-session] replayed deferred turn-started", {
            ...eventLogContext(replay.event),
            applied: result.applied,
            reason: result.reason,
          });
        } catch (error) {
          logger.warn(undefined, "[cua-pip-session] replay of deferred turn-started failed", {
            ...eventLogContext(replay.event),
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      });
      tail = operation;
    }, REPLAY_RETRY_MS);
    replayTimer.unref?.();
  };

  const publish = (event: PipSessionEvent): Promise<void> => {
    if (disposed) return Promise.resolve();
    const operation = tail.then(async () => {
      try {
        const resolution = await getClient();
        if (!resolution.client) {
          if (
            resolution.skipReason === "credentials-unavailable" ||
            resolution.skipReason === "transport-disabled"
          ) {
            if (event.kind === "turn-started") {
              pendingTurnStarted = { event, turnId: event.turnId };
              replayDeadline = Date.now() + REPLAY_DEADLINE_MS;
              scheduleReplayRetry();
            } else if (
              (event.kind === "turn-ended" || event.kind === "session-closed") &&
              pendingTurnStarted !== null &&
              ("turnId" in event
                ? pendingTurnStarted.turnId === event.turnId
                : pendingTurnStarted.event.sessionId === event.sessionId)
            ) {
              pendingTurnStarted = null;
              cancelReplayRetry();
            }
            logger.warn(undefined, "[cua-pip-session] event delivery skipped", {
              ...eventLogContext(event),
              skipReason: resolution.skipReason,
            });
          } else {
            logger.warn(undefined, "[cua-pip-session] event delivery dropped", {
              ...eventLogContext(event),
              skipReason: resolution.skipReason,
            });
          }
          return;
        }
        cancelReplayRetry();
        const replay = event.kind === "turn-started" ? null : pendingTurnStarted;
        pendingTurnStarted = null;
        if (replay !== null) {
          try {
            const replayed = await resolution.client.send(replay.event);
            logger.info(undefined, "[cua-pip-session] replayed deferred turn-started", {
              ...eventLogContext(replay.event),
              applied: replayed.applied,
              reason: replayed.reason,
            });
          } catch (error) {
            logger.warn(undefined, "[cua-pip-session] replay of deferred turn-started failed", {
              ...eventLogContext(replay.event),
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          }
        }
        const result = await resolution.client.send(event);
        logger.info(undefined, "[cua-pip-session] event delivery acknowledged", {
          ...eventLogContext(event),
          applied: result.applied,
          reason: result.reason,
        });
      } catch (error) {
        logger.warn(undefined, "[cua-pip-session] event delivery failed", {
          ...eventLogContext(event),
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    });
    tail = operation;
    return operation;
  };

  return {
    publishFocus: publish,
    publishLifecycle: publish,
    dispose() {
      disposed = true;
      cancelReplayRetry();
      pendingTurnStarted = null;
      current?.client.close();
      current = null;
    },
  };
}
