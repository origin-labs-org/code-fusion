import { useCallback, useMemo, useState } from "react";
import type { CfInstalledPluginSummary, CfPluginInfo } from "@origin-ai/cf-shared";
import type { IPluginManagementService } from "@origin-ai/cf-services";
import { usePluginManagementStore } from "@/store/pluginManagementStore.js";

interface UsePluginUninstallInput {
  store?: typeof usePluginManagementStore;
  pluginService: IPluginManagementService;
  installedPlugins: CfInstalledPluginSummary[];
  plugins: CfPluginInfo[];
  activeOperations: ReadonlyArray<{ id: string }>;
  onAfterUninstall: () => Promise<void>;
}

export interface PluginUninstallController {
  pendingPlugin: CfPluginInfo | CfInstalledPluginSummary | null;
  uninstalling: boolean;
  requestUninstall: (pluginId: string) => void;
  cancelUninstall: () => void;
  confirmUninstall: () => Promise<void>;
}

export function usePluginUninstall({
  store = usePluginManagementStore,
  pluginService,
  installedPlugins,
  plugins,
  activeOperations,
  onAfterUninstall,
}: UsePluginUninstallInput): PluginUninstallController {
  const uninstallPlugin = store((state) => state.uninstallPlugin);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const pendingPlugin = useMemo(() => {
    if (!pendingId) return null;
    return (
      installedPlugins.find((item) => item.id === pendingId) ??
      plugins.find((item) => item.id === pendingId) ??
      null
    );
  }, [installedPlugins, pendingId, plugins]);

  const uninstalling =
    pendingId !== null &&
    activeOperations.some((operation) => operation.id === `plugin:uninstall:${pendingId}`);

  const requestUninstall = useCallback((pluginId: string) => {
    setPendingId(pluginId);
  }, []);

  const cancelUninstall = useCallback(() => {
    setPendingId(null);
  }, []);

  const confirmUninstall = useCallback(async () => {
    if (!pendingId) return;
    await uninstallPlugin(pendingId, pluginService);
    if (store.getState().error) return;
    await onAfterUninstall();
    setPendingId(null);
  }, [pluginService, onAfterUninstall, pendingId, store, uninstallPlugin]);

  return { pendingPlugin, uninstalling, requestUninstall, cancelUninstall, confirmUninstall };
}
