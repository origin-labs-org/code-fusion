import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

export function bumpTaskListMembershipVersion(): void {
  version += 1;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function subscribeTaskListMembershipVersion(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTaskListMembershipVersion(): number {
  return version;
}

const BUMP_DEDUPE_WINDOW_MS = 500;
const BUMP_DEDUPE_MAX_KEYS = 256;
const recentBumpAtByKey = new Map<string, number>();

interface MembershipBumpEventLike {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId?: string;
  reason: string;
  taskMeta?: {
    updatedAt: number;
    unreadAt?: number;
  };
}

export function bumpTaskListMembershipVersionForWorkspaceEvent(
  event: MembershipBumpEventLike,
): void {
  if (!event.taskMeta || !event.taskId) {
    bumpTaskListMembershipVersion();
    return;
  }
  const workspaceKey = event.workspaceIdentity?.trim() || event.workspacePath;
  const dedupeKey = [
    workspaceKey,
    event.taskId,
    event.reason,
    event.taskMeta.updatedAt,
    event.taskMeta.unreadAt ?? "",
  ].join("::");
  const now = Date.now();
  const lastBumpAt = recentBumpAtByKey.get(dedupeKey);
  if (lastBumpAt !== undefined && now - lastBumpAt < BUMP_DEDUPE_WINDOW_MS) {
    return;
  }
  for (const [key, bumpedAt] of recentBumpAtByKey) {
    if (now - bumpedAt >= BUMP_DEDUPE_WINDOW_MS) {
      recentBumpAtByKey.delete(key);
    }
  }
  if (recentBumpAtByKey.size < BUMP_DEDUPE_MAX_KEYS) {
    recentBumpAtByKey.set(dedupeKey, now);
  }
  bumpTaskListMembershipVersion();
}

export function useTaskListMembershipVersion(): number {
  return useSyncExternalStore(
    subscribeTaskListMembershipVersion,
    getTaskListMembershipVersion,
  );
}
