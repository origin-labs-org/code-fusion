import type { SessionEvent } from "./session.events.js";
import { SessionEventType } from "./session.events.js";

export const TRANSIENT_SESSION_EVENT_TYPES: ReadonlySet<SessionEventType> = new Set([
  SessionEventType.ModelStreaming,
  SessionEventType.ToolCallProgress,
  SessionEventType.StreamingToolLedgerUpdated,
  SessionEventType.ModelNetworkStatus,
]);

export const SEALED_TURN_TRANSIENT_GRACE_MS = 120_000;

export function isTransientSessionEvent(event: Pick<SessionEvent, "type">): boolean {
  return TRANSIENT_SESSION_EVENT_TYPES.has(event.type);
}

export function slimRetainedModelRequest(event: SessionEvent): SessionEvent {
  if (event.type !== SessionEventType.ModelRequest) {
    return event;
  }
  const payload = event.payload as { messages?: unknown } | null | undefined;
  if (!payload || !Array.isArray(payload.messages)) {
    return event;
  }
  const { messages, ...metadata } = payload;
  return { ...event, payload: { ...metadata, messageCount: messages.length } } as SessionEvent;
}

export type SessionEventRetentionMode = "unbounded" | "turn-window";

export interface SessionEventRetentionPolicy {
  
  onAppend(event: Pick<SessionEvent, "type" | "turnId">, nowMs: number): readonly string[];
  
  collectExpired(nowMs: number, graceMs: number): readonly string[];
}

const NO_EVICTION: readonly string[] = [];

function createUnboundedRetention(): SessionEventRetentionPolicy {
  return { onAppend: () => NO_EVICTION, collectExpired: () => NO_EVICTION };
}

function createTurnWindowRetention(): SessionEventRetentionPolicy {
  const openTurns = new Set<string>();
  const sealedAt = new Map<string, number>();
  return {
    onAppend(event, nowMs) {
      const turnId = event.turnId;
      if (!turnId) {
        return NO_EVICTION;
      }
      switch (event.type) {
        case SessionEventType.TurnStarted: {
          const evict = [...sealedAt.keys()].filter((sealed) => sealed !== turnId);
          sealedAt.clear();
          openTurns.add(turnId);
          return evict;
        }
        case SessionEventType.TurnComplete:
        case SessionEventType.TurnError: {
          openTurns.delete(turnId);
          if (!sealedAt.has(turnId)) {
            sealedAt.set(turnId, nowMs);
          }
          return NO_EVICTION;
        }
        default:
          return NO_EVICTION;
      }
    },
    collectExpired(nowMs, graceMs) {
      const expired: string[] = [];
      for (const [turnId, at] of sealedAt) {
        if (nowMs - at >= graceMs) {
          expired.push(turnId);
        }
      }
      for (const turnId of expired) {
        sealedAt.delete(turnId);
      }
      return expired;
    },
  };
}

export function createSessionEventRetentionPolicy(
  mode: SessionEventRetentionMode,
): SessionEventRetentionPolicy {
  return mode === "unbounded" ? createUnboundedRetention() : createTurnWindowRetention();
}
