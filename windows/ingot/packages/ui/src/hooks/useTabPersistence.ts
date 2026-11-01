
import { useEffect, useRef } from "react";
import { useState } from "react";
import type { AppSettings } from "@origin-ai/cf-shared";
import type { ISettingService } from "@origin-ai/cf-services";
import { readPersistedWorkspaceSessionEntries } from "@/lib/remoteWorkspaceHistory.js";
import { useTabStoreApi } from "../store/TabStoreProvider.js";
import { isWorkspaceTab, type TabStoreState } from "../store/tabStore.js";
import { logger } from "../logger.js";

const DEBOUNCE_MS = 300;

export interface TabPersistenceRestoreLifecycle {
  settingService?: ISettingService;
  restoreSession: boolean;
  completed: boolean;
  fullyCompleted: boolean;
}

export interface WorkspacePersistenceGate {
  canPersist: boolean;
  restoreFailed: boolean;
  onCanPersist?: () => void | Promise<void>;
}

function openWorkspacePersistenceGate(
  persistenceGate: WorkspacePersistenceGate | undefined,
  persistSession: boolean,
): void {
  if (!persistenceGate) return;
  persistenceGate.canPersist = Boolean(persistSession);
  if (persistenceGate.canPersist) {
    void persistenceGate.onCanPersist?.();
  }
}

export interface TabPersistenceRestoreResult {
  
  excludedRecentProjectPaths?: readonly string[];
  
  deferredRestore?: () => void;
}

function scheduleDeferredRestore(callback: () => void): () => void {
  if (typeof globalThis.requestIdleCallback === "function") {
    const idleCallbackId = globalThis.requestIdleCallback(() => callback(), {
      timeout: 1_000,
    });
    return () => globalThis.cancelIdleCallback(idleCallbackId);
  }

  const timer = globalThis.setTimeout(callback, 0);
  return () => globalThis.clearTimeout(timer);
}

export function hasCompletedTabPersistenceInitialRestore({
  settingService,
  restoreSession,
  restoreLifecycle,
}: {
  settingService?: ISettingService;
  restoreSession: boolean;
  restoreLifecycle: TabPersistenceRestoreLifecycle;
}): boolean {
  const shouldRestoreSession = Boolean(settingService && restoreSession);
  return (
    !shouldRestoreSession ||
    (restoreLifecycle.settingService === settingService &&
      restoreLifecycle.restoreSession === restoreSession &&
      restoreLifecycle.completed)
  );
}

function buildDefaultPersistPatch(state: TabStoreState): Partial<AppSettings> {
  const tab = state.tabs
    .filter(isWorkspaceTab)
    .find(
      (candidate) =>
        (candidate.workspaceIdentity?.trim() || candidate.workspacePath) ===
        (state.activeWorkspaceIdentity?.trim() || state.activeWorkspacePath),
    );
  if (tab?.workspaceIdentity || tab?.remoteSessionId) return {};
  return {
    lastActiveWorkspace: tab
      ? {
          kind: "local",
          workspacePath: tab.workspacePath,
          ...(tab.workspacePurpose ? { workspacePurpose: tab.workspacePurpose } : {}),
        }
      : null,
  };
}

export function useTabPersistence({
  settingService,
  restoreSession = true,
  persistSession = restoreSession,
  persistenceGate,
  restorePersistedSession,
  buildPersistPatch,
}: {
  settingService?: ISettingService;
  
  restoreSession?: boolean;
  
  persistSession?: boolean;
  
  persistenceGate?: WorkspacePersistenceGate;
  
  restorePersistedSession?: (
    settings: AppSettings,
  ) => Promise<TabPersistenceRestoreResult | void> | TabPersistenceRestoreResult | void;
  
  buildPersistPatch?: (state: TabStoreState, settings: AppSettings) => Partial<AppSettings>;
}) {
  const store = useTabStoreApi();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldRestoreSession = Boolean(settingService && restoreSession);
  const initialRestoreFullyCompletedRef = useRef(!shouldRestoreSession);
  const [restoreLifecycle, setRestoreLifecycle] = useState<TabPersistenceRestoreLifecycle>(() => ({
    settingService,
    restoreSession,
    completed: !shouldRestoreSession,
    fullyCompleted: !shouldRestoreSession,
  }));
  const hasCompletedInitialRestore = hasCompletedTabPersistenceInitialRestore({
    settingService,
    restoreSession,
    restoreLifecycle,
  });
  const hasCompletedFullRestore =
    !shouldRestoreSession ||
    (restoreLifecycle.settingService === settingService &&
      restoreLifecycle.restoreSession === restoreSession &&
      restoreLifecycle.fullyCompleted);
  const isRestoring = shouldRestoreSession && !hasCompletedInitialRestore;

  useEffect(() => {
    if (!settingService || !restoreSession) {
      initialRestoreFullyCompletedRef.current = true;
      openWorkspacePersistenceGate(persistenceGate, persistSession);
      setRestoreLifecycle({
        settingService,
        restoreSession,
        completed: true,
        fullyCompleted: true,
      });
      return;
    }

    let cancelled = false;
    let cancelDeferredRestore: (() => void) | null = null;
    initialRestoreFullyCompletedRef.current = false;
    if (persistenceGate) {
      persistenceGate.canPersist = false;
      persistenceGate.restoreFailed = false;
    }
    setRestoreLifecycle({
      settingService,
      restoreSession,
      completed: false,
      fullyCompleted: false,
    });

    settingService
      .get()
      .then(async (settings) => {
        let restoreResult: TabPersistenceRestoreResult | void = undefined;
        if (restorePersistedSession) {
          restoreResult = await restorePersistedSession(settings);
        } else {
          const tabs = readPersistedWorkspaceSessionEntries(settings).flatMap((entry) =>
            entry.kind === "local"
              ? [
                  entry.workspacePurpose
                    ? {
                        workspacePath: entry.workspacePath,
                        workspacePurpose: entry.workspacePurpose,
                      }
                    : entry.workspacePath,
                ]
              : [],
          );
          const activeIndex = settings.lastActiveTabIndex ?? 0;
          if (tabs.length > 0) {
            logger.info("[useTabPersistence] 恢复标签页:", tabs);
            store.getState().restoreTabs(tabs, activeIndex);
          }
        }

        if (!cancelled) {
          const deferredRestore = restoreResult?.deferredRestore;
          setRestoreLifecycle({
            settingService,
            restoreSession,
            completed: true,
            fullyCompleted: !deferredRestore,
          });
          if (deferredRestore) {
            cancelDeferredRestore = scheduleDeferredRestore(() => {
              if (cancelled) {
                return;
              }
              initialRestoreFullyCompletedRef.current = true;
              openWorkspacePersistenceGate(persistenceGate, persistSession);
              try {
                deferredRestore();
              } catch (error) {
                logger.error("[useTabPersistence] 补齐 inactive workspace 失败:", error);
              } finally {
                if (!cancelled) {
                  setRestoreLifecycle({
                    settingService,
                    restoreSession,
                    completed: true,
                    fullyCompleted: true,
                  });
                }
              }
            });
          } else {
            initialRestoreFullyCompletedRef.current = true;
            openWorkspacePersistenceGate(persistenceGate, persistSession);
          }
        }
      })
      .catch((err) => {
        logger.error("[useTabPersistence] 恢复标签页失败:", err);
        if (!cancelled) {
          initialRestoreFullyCompletedRef.current = false;
          if (persistenceGate) {
            persistenceGate.canPersist = false;
            persistenceGate.restoreFailed = true;
          }
          setRestoreLifecycle({
            settingService,
            restoreSession,
            completed: true,
            fullyCompleted: true,
          });
        }
      });

    return () => {
      cancelled = true;
      cancelDeferredRestore?.();
    };
  }, [
    persistSession,
    persistenceGate,
    restorePersistedSession,
    settingService,
    restoreSession,
    store,
  ]);

  useEffect(() => {
    if (!settingService || !persistSession) return;

    const unsubscribe = store.subscribe((state) => {
      if (!initialRestoreFullyCompletedRef.current) {
        return;
      }
      if (persistenceGate && !persistenceGate.canPersist) {
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(() => {
        settingService
          .get()
          .then((settings) =>
            settingService.update(
              buildPersistPatch
                ? buildPersistPatch(state, settings)
                : buildDefaultPersistPatch(state),
            ),
          )
          .catch((err) => {
            logger.error("[useTabPersistence] 持久化失败:", err);
          });
      }, DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [buildPersistPatch, persistSession, persistenceGate, store, settingService]);

  return { isRestoring, hasCompletedInitialRestore, hasCompletedFullRestore };
}
