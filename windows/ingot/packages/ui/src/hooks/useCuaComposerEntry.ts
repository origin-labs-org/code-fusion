
import { useCallback, useEffect, useMemo, useRef } from "react";
import { isRemoteWorkspaceIdentity, CF_CUA_OFFICIAL_PLUGIN_ID } from "@origin-ai/cf-shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useCuaPermissionStatus } from "@/hooks/useCuaPermissionStatus.js";
import {
  resolveCuaComposerEntryView,
  type CuaComposerEntryView,
} from "@/lib/cuaComposerEntryState.js";
import {
  supportsLocalMacCuaPermissionOnboarding,
  supportsLocalWindowsCuaEntry,
} from "@/lib/cuaPlatform.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
import { usePluginManagementStore } from "@/store/pluginManagementStore.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";
import { getVisibleTaskMetas, getWorkspaceState } from "@/store/cfSessionStoreSelectors.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";

const RUNNING_TASK_STATUSES = new Set(["creating", "restoring", "streaming"]);

export interface UseCuaComposerEntryParams {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  
  isWebRemoteControl?: boolean;
  
  currentSessionBusy?: boolean;
}

export interface CuaComposerEntryController {
  view: CuaComposerEntryView;
  
  onActivate: () => void;
}

export function useCuaComposerEntry({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  isWebRemoteControl = false,
  currentSessionBusy = false,
}: UseCuaComposerEntryParams): CuaComposerEntryController {
  const platform = usePlatform();
  const services = useServices();
  const { settings } = useSettings();
  const openSettingsTab = useOptionalTabStore((state) => state.openSettingsTab);

  const macLocalDesktop = supportsLocalMacCuaPermissionOnboarding(platform);
  const windowsLocalDesktop = supportsLocalWindowsCuaEntry(platform);
  const isLocalWorkspace =
    !isWebRemoteControl &&
    !remoteSessionId &&
    !(workspaceIdentity?.trim() && isRemoteWorkspaceIdentity(workspaceIdentity.trim()));

  const hiddenBySettings = settings?.computerUseComposerEntryHidden !== false;

  const plugins = usePluginManagementStore((state) => state.plugins);
  const togglingPluginId = usePluginManagementStore((state) => state.togglingPluginId);
  const pluginStoreError = usePluginManagementStore((state) => state.error);
  const lastFailedPluginId = usePluginManagementStore((state) => state.lastFailedPluginId);
  const initializePlugins = usePluginManagementStore((state) => state.initialize);
  const cuaPlugin = plugins.find((plugin) => plugin.id === CF_CUA_OFFICIAL_PLUGIN_ID);
  const pluginEnabled = cuaPlugin?.enabled === true;

  const pluginManagementService = services.pluginManagementService;
  const platformSupported = (macLocalDesktop || windowsLocalDesktop) && isLocalWorkspace;
  const initializedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!platformSupported || hiddenBySettings || !workspacePath || !pluginManagementService) {
      return;
    }
    const key = `${workspacePath}\0${workspaceIdentity ?? ""}`;
    if (initializedKeyRef.current === key) return;
    initializedKeyRef.current = key;
    void initializePlugins({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      pluginService: pluginManagementService,
    });
  }, [
    hiddenBySettings,
    initializePlugins,
    platformSupported,
    pluginManagementService,
    workspaceIdentity,
    workspacePath,
  ]);

  const { status: permissionStatus } = useCuaPermissionStatus(null, workspaceIdentity);

  const workspaceSessionBusy = useCfSessionStore((state) => {
    const workspaceState = getWorkspaceState(state, workspacePath, workspaceIdentity);
    const runtimeBusy = Object.values(workspaceState.taskRuntimeByTaskId ?? {}).some(
      (runtime) =>
        RUNNING_TASK_STATUSES.has(runtime.status) || Boolean(runtime.activeInputId?.trim()),
    );
    if (runtimeBusy) return true;
    return getVisibleTaskMetas(workspaceState).some((task) => task.status === "running");
  });
  const sessionBusy = currentSessionBusy || workspaceSessionBusy;

  const view = useMemo(
    () =>
      resolveCuaComposerEntryView({
        macLocalDesktop: macLocalDesktop && isLocalWorkspace,
        windowsLocalDesktop: windowsLocalDesktop && isLocalWorkspace,
        hiddenBySettings,
        permissionServiceAvailable: Boolean(services.cuaPermissionService),
        pluginEnabled,
        pluginToggling: togglingPluginId === CF_CUA_OFFICIAL_PLUGIN_ID,
        pluginError:
          Boolean(pluginStoreError) && lastFailedPluginId === CF_CUA_OFFICIAL_PLUGIN_ID,
        permissionStatus: permissionStatus ?? null,
        sessionBusy,
      }),
    [
      cuaPlugin,
      hiddenBySettings,
      lastFailedPluginId,
      isLocalWorkspace,
      macLocalDesktop,
      permissionStatus,
      pluginEnabled,
      pluginStoreError,
      sessionBusy,
      services.cuaPermissionService,
      togglingPluginId,
      windowsLocalDesktop,
    ],
  );

  const onActivate = useCallback(() => {
    if (!view.visible || view.clickAction !== "open-settings") return;
    setPendingSettingsSectionIntent("computerUse");
    openSettingsTab();
  }, [openSettingsTab, view]);

  return { view, onActivate };
}
