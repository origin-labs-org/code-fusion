import type { SessionEvent } from "@origin-ai/cf-contracts";
import type { TuiCopy } from "@origin-ai/cf-i18n";
import React from "react";
import { applySessionEventToState } from "./app-events.js";
import { describeSessionEvent } from "./state.js";
import { isSubagentToolMirror } from "./app-subagent-events.js";

type SessionEventHandlers = Parameters<typeof applySessionEventToState>[1];

const MAX_REMEMBERED_EVENT_IDS = 2_048;

export function isMainSessionEvent(
  event: SessionEvent,
  mainSessionId: string | undefined,
): boolean {
  // Tool mirrors deliberately carry the parent's sessionId. They are activity
  // metadata, not parent transcript/tool/usage facts.
  if (isSubagentToolMirror(event)) return false;
  if (!mainSessionId) return true;
  const eventSessionId = typeof event.sessionId === "string" ? event.sessionId : undefined;
  if (eventSessionId === undefined) return true;
  return eventSessionId === mainSessionId;
}

type SessionEventApplierInput = SessionEventHandlers & {
  subscribeSessionEvents?: (sink: (event: SessionEvent) => void) => () => void;
  observeSessionEvent?: (event: SessionEvent) => void;
  copy: TuiCopy;
  getMainSessionId?: () => string | undefined;
  setLastEvent: (event: string) => void;
};

export function applyMainSessionEvent(
  event: SessionEvent,
  applied: Set<string>,
  input: SessionEventApplierInput,
): boolean {
  if (!isMainSessionEvent(event, input.getMainSessionId?.())) return false;
  if (!rememberSessionEvent(applied, event)) return false;
  input.setLastEvent(describeSessionEvent(event));
  applySessionEventToState(event, input, input.copy);
  return true;
}

export function useSessionEventApplier(
  input: SessionEventApplierInput,
): (event: SessionEvent) => void {
  const appliedEventIdsRef = React.useRef<Set<string>>(new Set());
  const applyEvent = React.useCallback(
    (event: SessionEvent) => {
      input.observeSessionEvent?.(event);
      applyMainSessionEvent(event, appliedEventIdsRef.current, input);
    },
    [input],
  );
  useSessionEventSubscription(input.subscribeSessionEvents, applyEvent);
  return applyEvent;
}

/** A stable subscription survives renders; both event sources share the applier. */
export function useSessionEventSubscription(
  subscribe: ((sink: (event: SessionEvent) => void) => () => void) | undefined,
  applyEvent: (event: SessionEvent) => void,
): void {
  const latest = React.useRef(applyEvent);
  latest.current = applyEvent;
  React.useEffect(() => subscribe?.((event) => latest.current(event)), [subscribe]);
}

export function rememberSessionEvent(applied: Set<string>, event: SessionEvent): boolean {
  const eventId = typeof event.id === "string" && event.id.length > 0 ? event.id : undefined;
  if (eventId === undefined) return true;
  if (applied.has(eventId)) return false;
  applied.add(eventId);
  if (applied.size > MAX_REMEMBERED_EVENT_IDS) {
    const excess = applied.size - MAX_REMEMBERED_EVENT_IDS;
    let removed = 0;
    for (const id of applied) {
      applied.delete(id);
      removed += 1;
      if (removed >= excess) break;
    }
  }
  return true;
}
