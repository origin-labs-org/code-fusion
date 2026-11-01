import type { PersistedWorkspaceSessionEntry } from "./protocol.js";

function findLocalWorkspaceSessionIndex(
  persistedSessions: readonly PersistedWorkspaceSessionEntry[],
  startIndex: number,
  endIndexExclusive: number,
): number | null {
  for (let index = startIndex; index < endIndexExclusive; index += 1) {
    if (persistedSessions[index]?.kind === "local") {
      return index;
    }
  }

  return null;
}

export function resolveStartupLocalWorkspaceSessionIndex(
  persistedSessions: readonly PersistedWorkspaceSessionEntry[],
  lastActiveTabIndex: number | undefined,
): number | null {
  if (persistedSessions.length === 0) {
    return null;
  }

  const startIndex = Math.min(Math.max(lastActiveTabIndex ?? 0, 0), persistedSessions.length - 1);
  const nextLocalIndex = findLocalWorkspaceSessionIndex(
    persistedSessions,
    startIndex,
    persistedSessions.length,
  );
  if (nextLocalIndex != null) {
    return nextLocalIndex;
  }

  return findLocalWorkspaceSessionIndex(persistedSessions, 0, startIndex);
}
