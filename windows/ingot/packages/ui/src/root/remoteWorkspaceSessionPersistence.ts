import type { AppSettings, RemoteWorkspaceSessionEntry } from "@origin-ai/cf-shared";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import {
  buildWorkspaceSessionKey,
  readPersistedWorkspaceSessionEntries,
  resolveRemoteWorkspaceSessionIdentity,
} from "@/lib/remoteWorkspaceHistory.js";
import { logger } from "@/logger.js";
import {
  isWorkspaceTab,
  type RestorableWorkspaceTab,
  type TabStore,
  type TabStoreState,
} from "@/store/tabStore.js";

function getRestorableWorkspaceKey(tab: string | RestorableWorkspaceTab): string {
  if (typeof tab === "string") {
    return tab;
  }
  return tab.workspaceIdentity?.trim() || tab.workspacePath;
}

function resolveRemoteConversationWorkspacePurpose(
  entry: Pick<
    RemoteWorkspaceSessionEntry,
    "workspaceIdentity" | "workspacePath" | "workspacePurpose"
  >,
  conversationWorkspaceMap: AppSettings["remoteConversationWorkspaceBySourceServerId"],
): RemoteWorkspaceSessionEntry["workspacePurpose"] {
  const parsedIdentity = parseRemoteWorkspaceIdentity(entry.workspaceIdentity ?? "");
  const canonicalConversationPath = parsedIdentity?.sourceServerId
    ? conversationWorkspaceMap?.[parsedIdentity.sourceServerId]?.workspacePath
    : undefined;
  return canonicalConversationPath === entry.workspacePath
    ? "conversation"
    : entry.workspacePurpose;
}

export function projectRemoteConversationWorkspacePurpose(
  remoteSessions: readonly RemoteWorkspaceSessionEntry[],
  conversationWorkspaceMap: AppSettings["remoteConversationWorkspaceBySourceServerId"],
): {
  remoteSessions: RemoteWorkspaceSessionEntry[];
  updatedEntries: Array<{
    workspacePath: string;
    workspaceIdentity?: string;
  }>;
} {
  const updatedEntries: Array<{
    workspacePath: string;
    workspaceIdentity?: string;
  }> = [];
  const projectedSessions = remoteSessions.map((entry) => {
    const workspacePurpose = resolveRemoteConversationWorkspacePurpose(
      entry,
      conversationWorkspaceMap,
    );
    if (workspacePurpose !== "conversation" || entry.workspacePurpose === "conversation") {
      return entry;
    }
    updatedEntries.push({
      workspacePath: entry.workspacePath,
      ...(entry.workspaceIdentity ? { workspaceIdentity: entry.workspaceIdentity } : {}),
    });
    return { ...entry, workspacePurpose };
  });
  return { remoteSessions: projectedSessions, updatedEntries };
}

export function buildRemoteWorkspacePersistPatch(
  state: TabStoreState,
  remoteSessions: readonly RemoteWorkspaceSessionEntry[],
): Partial<AppSettings> {
  const activeKey = state.activeWorkspaceIdentity?.trim() || state.activeWorkspacePath;
  const tab = state.tabs
    .filter(isWorkspaceTab)
    .find((candidate) => buildWorkspaceSessionKey(candidate) === activeKey);
  if (!tab) return { lastActiveWorkspace: null };
  if (tab.workspaceIdentity || tab.remoteSessionId) {
    const remote = remoteSessions.find((entry) => buildWorkspaceSessionKey(entry) === activeKey);
    return remote ? { lastActiveWorkspace: remote } : {};
  }
  return {
    lastActiveWorkspace: {
      kind: "local",
      workspacePath: tab.workspacePath,
      ...(tab.workspacePurpose ? { workspacePurpose: tab.workspacePurpose } : {}),
    },
  };
}

export function restorePersistedRemoteWorkspaceSessions({
  settings,
  tabStoreApi,
  allowRemoteWorkspaceRestore = true,
  unavailableWorkspacePath,
  conversationWorkspacePath,
  remoteConversationWorkspaceBySourceServerId,
  restoreMode = "all",
}: {
  settings: AppSettings;
  tabStoreApi: TabStore;
  allowRemoteWorkspaceRestore?: boolean;
  unavailableWorkspacePath?: string;
  conversationWorkspacePath?: string;
  remoteConversationWorkspaceBySourceServerId?: AppSettings["remoteConversationWorkspaceBySourceServerId"];
  restoreMode?: "all" | "active-first";
}): { deferredRestore?: () => void } | undefined {
  const persistedSessions = readPersistedWorkspaceSessionEntries(settings);
  const conversationWorkspaceMap =
    remoteConversationWorkspaceBySourceServerId ??
    settings.remoteConversationWorkspaceBySourceServerId;

  if (persistedSessions.length === 0 && !conversationWorkspacePath) {
    return;
  }

  const restoredTabs: Array<string | RestorableWorkspaceTab> = [];
  const seenLocalWorkspacePaths = new Set<string>();
  const seenRemoteWorkspaceKeys = new Set<string>();
  const activeSessionIndex = Math.min(
    Math.max(settings.lastActiveTabIndex ?? 0, 0),
    persistedSessions.length - 1,
  );
  let restoredActiveIndex = 0;
  let canonicalConversationRestoredIndex: number | null = null;
  let shouldActivateCanonicalConversation = false;

  for (const [index, persistedEntry] of persistedSessions.entries()) {
    if (persistedEntry.kind === "local") {
      const isStaleConversationWorkspace = Boolean(
        settings.lastActiveWorkspace === undefined &&
        conversationWorkspacePath &&
        persistedEntry.workspacePurpose === "conversation" &&
        persistedEntry.workspacePath !== conversationWorkspacePath,
      );
      if (isStaleConversationWorkspace) {
        logger.warn("[Root] Skipping non-canonical conversation workspace restoration", {
          workspacePath: persistedEntry.workspacePath,
          conversationWorkspacePath,
        });
        if (index === activeSessionIndex) {
          shouldActivateCanonicalConversation = true;
          if (canonicalConversationRestoredIndex !== null) {
            restoredActiveIndex = canonicalConversationRestoredIndex;
          }
        }
        continue;
      }

      if (seenLocalWorkspacePaths.has(persistedEntry.workspacePath)) {
        logger.warn("[Root] Skipping duplicate local workspace restoration", {
          workspacePath: persistedEntry.workspacePath,
        });
        continue;
      }

      const isConversationWorkspace =
        persistedEntry.workspacePath === conversationWorkspacePath ||
        persistedEntry.workspacePurpose === "conversation";
      const workspacePurpose = isConversationWorkspace
        ? "conversation"
        : persistedEntry.workspacePurpose;
      const availability =
        !isConversationWorkspace && persistedEntry.workspacePath === unavailableWorkspacePath
          ? "unavailable-local-directory"
          : undefined;
      if (availability && index === activeSessionIndex && conversationWorkspacePath) {
        shouldActivateCanonicalConversation = true;
        logger.info("[Root] Default project unavailable; restoring draft without project", {
          workspacePath: persistedEntry.workspacePath,
          conversationWorkspacePath,
        });
      }
      restoredTabs.push(
        workspacePurpose || availability
          ? {
              workspacePath: persistedEntry.workspacePath,
              workspacePurpose,
              availability,
            }
          : persistedEntry.workspacePath,
      );
      seenLocalWorkspacePaths.add(persistedEntry.workspacePath);
      const restoredIndex = restoredTabs.length - 1;
      if (isConversationWorkspace) {
        canonicalConversationRestoredIndex = restoredIndex;
      }
      if (
        index === activeSessionIndex ||
        (isConversationWorkspace && shouldActivateCanonicalConversation)
      ) {
        restoredActiveIndex = restoredIndex;
      }
      continue;
    }

    const workspaceIdentity = resolveRemoteWorkspaceSessionIdentity(persistedEntry);
    const workspaceKey = workspaceIdentity?.trim() || persistedEntry.workspacePath;
    const workspacePurpose = resolveRemoteConversationWorkspacePurpose(
      persistedEntry,
      conversationWorkspaceMap,
    );
    if (workspacePurpose === "conversation") continue;
    if (seenRemoteWorkspaceKeys.has(workspaceKey)) {
      logger.warn("[Root] Skipping restoration of remote workspace with identity conflict", {
        workspacePath: persistedEntry.workspacePath,
        workspaceIdentity,
      });
      continue;
    }

    if (!allowRemoteWorkspaceRestore) {
      continue;
    }

    restoredTabs.push({
      workspacePath: persistedEntry.workspacePath,
      remoteTarget: persistedEntry.target,
      workspaceIdentity,
      ...(workspacePurpose ? { workspacePurpose } : {}),
    });
    seenRemoteWorkspaceKeys.add(workspaceKey);
    if (index === activeSessionIndex) {
      restoredActiveIndex = restoredTabs.length - 1;
    }
  }

  if (
    (!settings.lastActiveWorkspace || shouldActivateCanonicalConversation) &&
    conversationWorkspacePath &&
    !seenLocalWorkspacePaths.has(conversationWorkspacePath)
  ) {
    restoredTabs.push({
      workspacePath: conversationWorkspacePath,
      workspacePurpose: "conversation",
    });
    canonicalConversationRestoredIndex = restoredTabs.length - 1;
  }

  if (shouldActivateCanonicalConversation && canonicalConversationRestoredIndex !== null) {
    restoredActiveIndex = canonicalConversationRestoredIndex;
  }

  if (restoredTabs.length > 0) {
    if (restoreMode === "active-first" && restoredTabs.length > 1) {
      const activeTab = restoredTabs[restoredActiveIndex];
      if (activeTab) {
        const activeWorkspaceKey = getRestorableWorkspaceKey(activeTab);
        logger.info("[Root] Restoring active workspace first", {
          deferredCount: restoredTabs.length - 1,
        });
        tabStoreApi.getState().restoreTabs([activeTab], 0);
        return {
          deferredRestore: () => {
            const startupActiveStillOpen = tabStoreApi
              .getState()
              .tabs.filter(isWorkspaceTab)
              .some(
                (tab) =>
                  (tab.workspaceIdentity?.trim() || tab.workspacePath) === activeWorkspaceKey,
              );
            const tabsToComplete = startupActiveStillOpen
              ? restoredTabs
              : restoredTabs.filter(
                  (restoredTab) => getRestorableWorkspaceKey(restoredTab) !== activeWorkspaceKey,
                );
            logger.info("[Root] 首帧后补齐 inactive workspace", {
              count: tabsToComplete.length - (startupActiveStillOpen ? 1 : 0),
            });
            tabStoreApi.getState().completeTabRestore(tabsToComplete);
          },
        };
      }
    }
    logger.info("[Root] 恢复组合 workspace 会话", {
      count: restoredTabs.length,
      activeIndex: restoredActiveIndex,
    });
    tabStoreApi.getState().restoreTabs(restoredTabs, restoredActiveIndex);
  }
  return undefined;
}
