//
import {
  pendingCommandRegistry,
  type PendingCommandResolution,
} from "@/v4/pendingCommandRegistry.js";

export interface UnsettledComposerSubmission {
  commandId: string;
  
  text: string;
}

type SettledListener = (submission: UnsettledComposerSubmission) => void;

interface TrackedSubmission extends UnsettledComposerSubmission {
  settled: boolean;
  unsubscribe: () => void;
}

const trackedByScope = new Map<string, TrackedSubmission>();
const listenersByScope = new Map<string, Set<SettledListener>>();

function isAuthoritativeResolution(resolution: PendingCommandResolution): boolean {
  return resolution === "accepted" || resolution === "duplicate" || resolution === "authoritative";
}

function deliver(scopeKey: string, tracked: TrackedSubmission): void {
  const listeners = listenersByScope.get(scopeKey);
  if (!listeners || listeners.size === 0) return;
  trackedByScope.delete(scopeKey);
  const submission = { commandId: tracked.commandId, text: tracked.text };
  for (const listener of listeners) listener(submission);
}

export function trackUnsettledComposerSubmission(
  scopeKey: string,
  submission: UnsettledComposerSubmission,
): void {
  trackedByScope.get(scopeKey)?.unsubscribe();
  const tracked: TrackedSubmission = {
    ...submission,
    settled: false,
    unsubscribe: () => undefined,
  };
  trackedByScope.set(scopeKey, tracked);
  tracked.unsubscribe = pendingCommandRegistry.subscribeResolution(
    submission.commandId,
    (resolution) => {
      if (trackedByScope.get(scopeKey) !== tracked) return;
      if (!isAuthoritativeResolution(resolution)) {
        trackedByScope.delete(scopeKey);
        return;
      }
      tracked.settled = true;
      deliver(scopeKey, tracked);
    },
  );
}

export function subscribeComposerSubmissionSettled(
  scopeKey: string,
  listener: SettledListener,
): () => void {
  const listeners = listenersByScope.get(scopeKey) ?? new Set<SettledListener>();
  listeners.add(listener);
  listenersByScope.set(scopeKey, listeners);
  const tracked = trackedByScope.get(scopeKey);
  if (tracked?.settled) deliver(scopeKey, tracked);
  return () => {
    const current = listenersByScope.get(scopeKey);
    current?.delete(listener);
    if (current?.size === 0) listenersByScope.delete(scopeKey);
  };
}
