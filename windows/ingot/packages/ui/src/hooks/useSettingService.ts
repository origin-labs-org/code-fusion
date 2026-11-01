
import { useState, useEffect, useCallback } from "react";
import { APP_RUNTIME_PREFERENCES_CHANGED_BROADCAST_CHANNEL, type AppSettings } from "@origin-ai/cf-shared";
import type { IServiceAccessor, ISettingService } from "@origin-ai/cf-services";
import { useServices } from "./useServices.js";
import { usePlatform } from "./usePlatform.js";

type SettingsSnapshot = {
  settings: AppSettings | null;
  loading: boolean;
  error: unknown | null;
};

const INITIAL_SETTINGS_SNAPSHOT: SettingsSnapshot = {
  settings: null,
  loading: true,
  error: null,
};
const snapshots = new Map<string, SettingsSnapshot>();
const inflightRefreshes = new Map<string, Promise<void>>();
const listenersByKey = new Map<string, Set<(snapshot: SettingsSnapshot) => void>>();
const defaultCacheKeyByServices = new WeakMap<object, string>();
let nextDefaultCacheKey = 0;

function resolveSettingsCacheKey(
  explicitCacheKey: string | undefined,
  settingService: object | undefined,
): string {
  const explicit = explicitCacheKey?.trim();
  if (explicit) return explicit;

  if (!settingService) return "settings-services:missing";

  const existing = defaultCacheKeyByServices.get(settingService);
  if (existing) return existing;

  const created = `settings-services:${++nextDefaultCacheKey}`;
  defaultCacheKeyByServices.set(settingService, created);
  return created;
}

function getSettingsSnapshot(cacheKey: string): SettingsSnapshot {
  return snapshots.get(cacheKey) ?? INITIAL_SETTINGS_SNAPSHOT;
}

function setSettingsSnapshot(cacheKey: string, snapshot: SettingsSnapshot): void {
  snapshots.set(cacheKey, snapshot);
  for (const listener of listenersByKey.get(cacheKey) ?? []) {
    listener(snapshot);
  }
}

async function refreshSharedSettings(cacheKey: string, getSettings: () => Promise<AppSettings>) {
  const inflight = inflightRefreshes.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  setSettingsSnapshot(cacheKey, {
    ...getSettingsSnapshot(cacheKey),
    loading: true,
    error: null,
  });

  const refreshPromise = (async () => {
    try {
      const result = await getSettings();
      setSettingsSnapshot(cacheKey, {
        settings: result,
        loading: false,
        error: null,
      });
    } catch (error) {
      setSettingsSnapshot(cacheKey, {
        settings: getSettingsSnapshot(cacheKey).settings,
        loading: false,
        error,
      });
    }
  })().finally(() => {
    inflightRefreshes.delete(cacheKey);
  });
  inflightRefreshes.set(cacheKey, refreshPromise);

  return refreshPromise;
}

export async function updateSettingsAndRefreshSnapshot(params: {
  settingService: Pick<ISettingService, "get" | "update">;
  patch: Partial<AppSettings>;
}): Promise<void> {
  const cacheKey = resolveSettingsCacheKey(undefined, params.settingService);
  await params.settingService.update(params.patch);
  await refreshSharedSettings(cacheKey, () => params.settingService.get());
}

export function useSettings(options: { cacheKey?: string; services?: IServiceAccessor } = {}) {
  const contextualServices = useServices();
  const settingsServices = options.services ?? contextualServices;
  const { botsService, broadcastService, settingService, cfAgentService } = settingsServices;
  const platform = usePlatform();
  const cacheKey = resolveSettingsCacheKey(options.cacheKey, settingService);
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>(() => getSettingsSnapshot(cacheKey));

  const refresh = useCallback(async () => {
    await refreshSharedSettings(cacheKey, () => settingService.get());
  }, [cacheKey, settingService]);

  useEffect(() => {
    const listener = (nextSnapshot: SettingsSnapshot) => {
      setSnapshot(nextSnapshot);
    };

    const listeners = listenersByKey.get(cacheKey) ?? new Set();
    listeners.add(listener);
    listenersByKey.set(cacheKey, listeners);
    setSnapshot(getSettingsSnapshot(cacheKey));
    void refresh();

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) listenersByKey.delete(cacheKey);
    };
  }, [cacheKey, refresh]);

  useEffect(() => {
    return (
      platform.onSettingsChanged?.(() => {
        void refresh();
      }) ?? (() => {})
    );
  }, [platform, refresh]);

  const update = useCallback(
    async (
      patch: Partial<AppSettings>,
      expectedAccountSettings?: Parameters<ISettingService["update"]>[1],
    ) => {
      try {
        if (expectedAccountSettings) await settingService.update(patch, expectedAccountSettings);
        else await settingService.update(patch);
      } catch (error) {
        if (expectedAccountSettings) await refresh();
        throw error;
      }
      platform.syncAppSettings?.(patch);
      await refresh();
      if (
        typeof patch.askUserQuestionAutoResolutionEnabled === "boolean" ||
        typeof patch.modelIoFullRetentionEnabled === "boolean"
      ) {
        const currentSettings = getSettingsSnapshot(cacheKey).settings;
        const preferences = {
          askUserQuestionAutoResolutionEnabled:
            patch.askUserQuestionAutoResolutionEnabled ??
            currentSettings?.askUserQuestionAutoResolutionEnabled !== false,
          modelIoFullRetentionEnabled:
            patch.modelIoFullRetentionEnabled ??
            currentSettings?.modelIoFullRetentionEnabled === true,
        };
        const syncResults = await Promise.allSettled([
          cfAgentService.syncAppRuntimePreferences(preferences),
          botsService.syncAppRuntimePreferences(preferences),
        ]);
        const syncError = syncResults.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        )?.reason;
        await broadcastService.send({
          channel: APP_RUNTIME_PREFERENCES_CHANGED_BROADCAST_CHANNEL,
          payload: preferences,
        });
        if (syncError) {
          throw syncError;
        }
      }
    },
    [botsService, broadcastService, cacheKey, settingService, cfAgentService, platform, refresh],
  );

  return {
    settings: snapshot.settings,
    loading: snapshot.loading,
    error: snapshot.error,
    update,
    refresh,
  };
}

export function useRecentProjects() {
  const { settings, loading, update } = useSettings();
  return {
    recentProjects: settings?.recentProjects ?? [],
    loading,
    addProject: async (path: string) => {
      const current = settings?.recentProjects ?? [];
      const updated = [path, ...current.filter((p) => p !== path)].slice(0, 10);
      await update({ recentProjects: updated });
    },
  };
}
