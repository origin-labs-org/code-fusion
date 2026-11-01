
//
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSettings } from "@/hooks/useSettingService.js";
import type { CuaOsSupport, CuaPermissionKind, RemoteTarget } from "@origin-ai/cf-shared";
import {
  DesktopCommandIds,
  isRemoteWorkspaceIdentity,
  CF_CUA_OFFICIAL_PLUGIN_ID,
} from "@origin-ai/cf-shared";
import { isCuaPermissionStatusAvailable, type CuaPermissionRestartOptions } from "@origin-ai/cf-services";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { Switch } from "@/components/ui/switch.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useCuaPermissionStatus } from "@/hooks/useCuaPermissionStatus.js";
import {
  claimCuaPermissionReturnRecovery,
  completeCuaPermissionReturnRecovery,
  captureCuaPermissionReturnRecovery,
  createCuaPermissionReturnRecoveryState,
  isCuaPermissionReturnRecoveryCurrent,
  markCuaPermissionOnboardingOpened,
  shouldRestartHelperAfterCuaPermissionReturn,
  type CuaPermissionReturnRecoveryClaim,
} from "@/lib/cuaPermissionAction.js";
import { usePluginManagementStore } from "@/store/pluginManagementStore.js";
import { SettingsBadge, SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { StatusDot, type StatusDotTone } from "@/settings/StatusDot.js";
import { supportsLocalMacCuaPermissionOnboarding } from "@/lib/cuaPlatform.js";
import { runAfterSuccessfulPluginEnabledChange } from "@/settings/pluginEnabledChange.js";
import { createCuaPermissionOnboardingOperationId } from "@/lib/cuaPermissionOnboardingOperation.js";
import { waitForAccessibilityNotStale } from "@/settings/cuaPermissionRestartVerify.js";
import { requiredCuaPermissionsForFreshStatus } from "@/settings/cuaPermissionPreparation.js";
import { ExternalLink } from "lucide-react";
import {
  isComputerUseRemoteOrLinux,
  resolveComputerUseAvailability,
} from "@/settings/computerUseAvailability.js";

interface ComputerUseSectionProps {
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  workspacePath?: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  remoteTarget?: RemoteTarget | null;
  localWorkspacePath?: string | null;
}

export function ComputerUseSection({
  isDesktop = false,
  isMacDesktop,
  isWindowsDesktop = false,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
  localWorkspacePath,
}: ComputerUseSectionProps) {
  const { intl } = useCfIntl();
  const services = useServices();
  const platform = usePlatform();
  const pluginManagementService = services.pluginManagementService;
  const cuaPermissionService = services.cuaPermissionService;
  const isLocalWorkspace =
    !remoteSessionId &&
    !remoteTarget &&
    !(workspaceIdentity?.trim() && isRemoteWorkspaceIdentity(workspaceIdentity.trim()));
  const supportsLocalMacWorkspace =
    !isWindowsDesktop &&
    (isMacDesktop ?? supportsLocalMacCuaPermissionOnboarding(platform)) &&
    isLocalWorkspace;
  const supportsLocalWindowsWorkspace = isWindowsDesktop && isLocalWorkspace;
  const supportsComputerUseSettings = supportsLocalMacWorkspace || supportsLocalWindowsWorkspace;
  const availability = resolveComputerUseAvailability({
    isDesktop: isDesktop || isWindowsDesktop || supportsLocalMacWorkspace,
    isMacDesktop: isMacDesktop || supportsLocalMacWorkspace,
    isWindowsDesktop,
    remoteSessionId,
    remoteTarget,
    workspaceIdentity,
  });
  const path = supportsLocalMacWorkspace ? (localWorkspacePath ?? workspacePath) : null;
  const { status, settled, refresh } = useCuaPermissionStatus(path ?? null, workspaceIdentity);
  const availableStatus = status && isCuaPermissionStatusAvailable(status) ? status : null;

  const [osSupport, setOsSupport] = useState<CuaOsSupport | null>(null);
  useEffect(() => {
    if (!supportsLocalMacWorkspace || typeof platform.executeDesktopCommand !== "function") return;
    let cancelled = false;
    void platform
      .executeDesktopCommand(DesktopCommandIds.GetCuaOsSupport)
      .then((result) => {
        if (!cancelled) setOsSupport(result as CuaOsSupport);
      })
      .catch(() => {
        
      });
    return () => {
      cancelled = true;
    };
  }, [supportsLocalMacWorkspace, platform]);

  const macOsBelowCuaFloor = osSupport?.kind === "macos-below-minimum";

  const plugins = usePluginManagementStore((state) => state.plugins);
  const setPluginEnabled = usePluginManagementStore((state) => state.setEnabled);
  const initializePlugins = usePluginManagementStore((state) => state.initialize);
  const togglingPluginId = usePluginManagementStore((state) => state.togglingPluginId);
  const cuaPlugin = plugins.find((plugin) => plugin.id === CF_CUA_OFFICIAL_PLUGIN_ID);
  const cuaEnabled = cuaPlugin?.enabled ?? false;
  const cuaToggling = togglingPluginId === CF_CUA_OFFICIAL_PLUGIN_ID;

  const initRef = useRef(false);
  useEffect(() => {
    if (
      initRef.current ||
      !supportsComputerUseSettings ||
      !workspacePath ||
      !pluginManagementService
    )
      return;
    initRef.current = true;
    void initializePlugins({
      workspacePath,
      workspaceIdentity,
      pluginService: pluginManagementService,
    });
  }, [
    supportsComputerUseSettings,
    workspacePath,
    workspaceIdentity,
    pluginManagementService,
    initializePlugins,
  ]);

  const [restarting, setRestarting] = useState(false);
  const restartPromiseRef = useRef<Promise<boolean> | null>(null);
  const pendingGrantSessionIdRef = useRef<string | undefined>(undefined);
  const returnRecoveryRef = useRef(createCuaPermissionReturnRecoveryState());
  useEffect(() => {
    returnRecoveryRef.current = createCuaPermissionReturnRecoveryState(
      workspaceIdentity?.trim() || path || "<none>",
    );
    pendingGrantSessionIdRef.current = undefined;
  }, [path, workspaceIdentity]);
  const [verifyTimedOut, setVerifyTimedOut] = useState(false);
  const mountedRef = useRef(true);
  const pluginToggleGenerationRef = useRef(0);
  const pluginToggleContextKey = [
    workspacePath ?? "",
    workspaceIdentity ?? "",
    localWorkspacePath ?? "",
    remoteSessionId ?? "",
    remoteTarget ? "remote" : "local",
  ].join("\u0000");
  const pluginToggleContextKeyRef = useRef(pluginToggleContextKey);
  pluginToggleContextKeyRef.current = pluginToggleContextKey;
  const helperContextKey = [path ?? "", workspaceIdentity?.trim() ?? ""].join("\u0000");
  const helperContextKeyRef = useRef(helperContextKey);
  helperContextKeyRef.current = helperContextKey;
  const activeOnboardingOperationIdRef = useRef<string | null>(null);
  const permissionStatusCheckTokenRef = useRef<symbol | null>(null);
  const platformRef = useRef(platform);
  platformRef.current = platform;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pluginToggleGenerationRef.current += 1;
      permissionStatusCheckTokenRef.current = null;
      const operationId = activeOnboardingOperationIdRef.current;
      activeOnboardingOperationIdRef.current = null;
      if (operationId) {
        platformRef.current.cancelCuaPermissionOnboarding?.(operationId);
      }
    };
  }, []);

  useEffect(
    () => () => {
      permissionStatusCheckTokenRef.current = null;
      const operationId = activeOnboardingOperationIdRef.current;
      activeOnboardingOperationIdRef.current = null;
      if (operationId) {
        platformRef.current.cancelCuaPermissionOnboarding?.(operationId);
      }
    },
    [path, workspaceIdentity],
  );

  const onRestart = useCallback(
    (
      targetPath = path,
      targetWorkspaceIdentity = workspaceIdentity,
      restartOptions?: CuaPermissionRestartOptions,
    ): Promise<boolean> => {
      if (!targetPath || !services || !cuaPermissionService) return Promise.resolve(false);
      if (restartPromiseRef.current) return restartPromiseRef.current;
      const targetContextKey = [targetPath, targetWorkspaceIdentity?.trim() ?? ""].join("\u0000");
      if (helperContextKeyRef.current === targetContextKey) {
        setVerifyTimedOut(false);
      }
      setRestarting(true);
      const operation = (async (): Promise<boolean> => {
        let queuedActiveProbe = false;
        try {
          const result = await cuaPermissionService.restartHelper(
            targetPath,
            targetWorkspaceIdentity,
            restartOptions,
          );
          if (!result.ok && mountedRef.current) {
            toast(
              intl.formatMessage(
                { id: "cuaPermission.modal.restartFailed" },
                { error: result.reason ?? "unknown error" },
              ),
            );
            return false;
          }
          if (!result.ok) return false;

          const stillStale = await waitForAccessibilityNotStale(() =>
            cuaPermissionService.getStatus(targetPath, targetWorkspaceIdentity),
          );
          if (mountedRef.current && helperContextKeyRef.current === targetContextKey) {
            setVerifyTimedOut(stillStale);
            refresh({ includeFunctionalProbes: true });
            queuedActiveProbe = true;
          }
          return true;
        } catch (error) {
          if (mountedRef.current) {
            toast(
              intl.formatMessage(
                { id: "cuaPermission.modal.restartFailed" },
                {
                  error: error instanceof Error ? error.message : String(error),
                },
              ),
            );
          }
          return false;
        } finally {
          restartPromiseRef.current = null;
          if (mountedRef.current) {
            setRestarting(false);
            if (!queuedActiveProbe) refresh();
          }
        }
      })();
      restartPromiseRef.current = operation;
      return operation;
    },
    [path, workspaceIdentity, services, refresh, intl],
  );

  const applyPendingGrant = useCallback(
    async (
      expectedClaim?: CuaPermissionReturnRecoveryClaim,
      target?: { workspacePath: string; workspaceIdentity?: string },
      onboardingSessionId?: string,
    ): Promise<boolean> => {
      const claim = expectedClaim ?? captureCuaPermissionReturnRecovery(returnRecoveryRef.current);
      if (!claim || !isCuaPermissionReturnRecoveryCurrent(claim.state, claim)) {
        return false;
      }
      const existing = restartPromiseRef.current;
      if (existing) await existing;
      if (!isCuaPermissionReturnRecoveryCurrent(claim.state, claim)) return false;
      const ok = await onRestart(target?.workspacePath, target?.workspaceIdentity, {
        reason: "permission_granted",
        ...((onboardingSessionId ?? pendingGrantSessionIdRef.current)
          ? {
              onboardingSessionId: onboardingSessionId ?? pendingGrantSessionIdRef.current,
            }
          : {}),
      });
      completeCuaPermissionReturnRecovery(claim, ok);
      return ok;
    },
    [onRestart],
  );

  const onRelaunchApp = useCallback(async () => {
    if (typeof platform.executeDesktopCommand !== "function") return;
    await platform.executeDesktopCommand(DesktopCommandIds.RelaunchApp);
  }, [platform]);

  const onTogglePlugin = useCallback(
    async (next: boolean) => {
      if (!pluginManagementService) return;
      const operationGeneration = ++pluginToggleGenerationRef.current;
      const operationContextKey = pluginToggleContextKey;
      const completed = await runAfterSuccessfulPluginEnabledChange({
        submit: () => setPluginEnabled(CF_CUA_OFFICIAL_PLUGIN_ID, next, pluginManagementService),
        isCurrent: () =>
          mountedRef.current &&
          pluginToggleGenerationRef.current === operationGeneration &&
          pluginToggleContextKeyRef.current === operationContextKey,
        onSuccess: () => {
          if (supportsLocalMacWorkspace) {
            refresh();
          }
          if (!next) {
            toast(intl.formatMessage({ id: "settings.computerUse.disabledToast" }));
          }
        },
      });
      if (!completed && mountedRef.current) {
        const message = usePluginManagementStore.getState().error;
        if (message) {
          toast(message);
        }
      }
    },
    [
      path,
      pluginManagementService,
      pluginToggleContextKey,
      refresh,
      setPluginEnabled,
      supportsLocalMacWorkspace,
      intl,
    ],
  );

  const openPermissionSettings = useCallback(
    async (initialPermission: CuaPermissionKind): Promise<void> => {
      if (
        typeof platform.openCuaPermissionOnboarding !== "function" ||
        activeOnboardingOperationIdRef.current ||
        permissionStatusCheckTokenRef.current
      ) {
        return;
      }
      const checkToken = Symbol("cua-permission-status-check");
      permissionStatusCheckTokenRef.current = checkToken;
      const operationContextKey = helperContextKey;
      let operationId: string | null = null;
      const recoveryState = returnRecoveryRef.current;
      const recoveryTarget = path
        ? {
            workspacePath: path,
            ...(workspaceIdentity ? { workspaceIdentity } : {}),
          }
        : null;
      try {
        if (!path || !cuaPermissionService) {
          toast(intl.formatMessage({ id: "cuaPermission.modal.unavailable" }));
          return;
        }
        let currentStatus = await cuaPermissionService.getStatus(path, workspaceIdentity, {
          includeFunctionalProbes: false,
        });
        for (
          let attempt = 0;
          attempt < 2 && !isCuaPermissionStatusAvailable(currentStatus);
          attempt += 1
        ) {
          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
          if (
            !mountedRef.current ||
            permissionStatusCheckTokenRef.current !== checkToken ||
            helperContextKeyRef.current !== operationContextKey ||
            returnRecoveryRef.current !== recoveryState
          ) {
            return;
          }
          currentStatus = await cuaPermissionService.getStatus(path, workspaceIdentity, {
            includeFunctionalProbes: false,
          });
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (
          !mountedRef.current ||
          permissionStatusCheckTokenRef.current !== checkToken ||
          helperContextKeyRef.current !== operationContextKey ||
          returnRecoveryRef.current !== recoveryState
        ) {
          return;
        }
        if (
          !isCuaPermissionStatusAvailable(currentStatus) ||
          !requiredCuaPermissionsForFreshStatus(currentStatus).includes(initialPermission)
        ) {
          const permissionState = isCuaPermissionStatusAvailable(currentStatus)
            ? initialPermission === "accessibility"
              ? currentStatus.accessibility
              : currentStatus.screenRecording
            : null;
          toast(
            intl.formatMessage({
              id:
                permissionState === "granted"
                  ? "cuaPermission.grantAlreadySatisfied"
                  : "cuaPermission.modal.unavailable",
            }),
          );
          refresh();
          return;
        }
        operationId = createCuaPermissionOnboardingOperationId();
        activeOnboardingOperationIdRef.current = operationId;
        const result = await platform.openCuaPermissionOnboarding({
          initialPermission,
          operationId,
          requiredPermissions: [initialPermission],
        });
        if (
          !mountedRef.current ||
          activeOnboardingOperationIdRef.current !== operationId ||
          helperContextKeyRef.current !== operationContextKey
        ) {
          return;
        }
        if (shouldRestartHelperAfterCuaPermissionReturn(result)) {
          markCuaPermissionOnboardingOpened(recoveryState);
          pendingGrantSessionIdRef.current = result.sessionId;
          const claim = claimCuaPermissionReturnRecovery(recoveryState);
          if (claim && recoveryTarget) {
            void applyPendingGrant(claim, recoveryTarget, result.sessionId);
          }
        } else if (result?.success && result.returnedFromSettings) {
          refresh();
        }
        if (result?.success === false && !result.canceled) {
          toast(
            intl.formatMessage(
              { id: "chat.cuaPermission.openFailed" },
              { error: result.error ?? "unknown error" },
            ),
          );
        }
      } catch (error) {
        if (
          mountedRef.current &&
          permissionStatusCheckTokenRef.current === checkToken &&
          helperContextKeyRef.current === operationContextKey
        ) {
          toast(
            operationId
              ? intl.formatMessage(
                  { id: "chat.cuaPermission.openFailed" },
                  {
                    error: error instanceof Error ? error.message : String(error),
                  },
                )
              : intl.formatMessage({ id: "cuaPermission.modal.unavailable" }),
          );
        }
      } finally {
        if (permissionStatusCheckTokenRef.current === checkToken) {
          permissionStatusCheckTokenRef.current = null;
        }
        if (operationId && activeOnboardingOperationIdRef.current === operationId) {
          activeOnboardingOperationIdRef.current = null;
        }
      }
    },
    [platform, path, services, workspaceIdentity, intl, applyPendingGrant, refresh],
  );

  const onManualRestart = useCallback((): void => {
    void (returnRecoveryRef.current.pending ? applyPendingGrant() : onRestart());
  }, [applyPendingGrant, onRestart]);

  useEffect(() => {
    if (availableStatus?.accessibility === "granted") setVerifyTimedOut(false);
  }, [availableStatus?.accessibility]);

  const renderGrantDetail = (kind: CuaPermissionKind, labelId: string): ReactNode => {
    if (typeof platform.openCuaPermissionOnboarding !== "function") return null;
    return (
      <Button
        type="button"
        variant="link"
        size="sm"
        className="text-sky-500 hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300"
        aria-label={intl.formatMessage({ id: labelId })}
        title={intl.formatMessage({ id: labelId })}
        disabled={!settled}
        onClick={() => void openPermissionSettings(kind)}
      >
        <ExternalLink className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">
          {intl.formatMessage({
            id: settled ? labelId : "cuaPermission.status.verifying",
          })}
        </span>
      </Button>
    );
  };

  const statusView = (
    state: "granted" | "stale" | "denied" | "unknown" | undefined,
  ): { tone: StatusDotTone; text: string } => {
    if (state === "granted") {
      return {
        tone: "green",
        text: intl.formatMessage({ id: "cuaPermission.status.granted" }),
      };
    }
    if (state === "stale") {
      return {
        tone: "amber",
        text: intl.formatMessage({ id: "cuaPermission.status.stale" }),
      };
    }
    if (state === "denied") {
      return {
        tone: "red",
        text: intl.formatMessage({ id: "cuaPermission.status.missing" }),
      };
    }
    return {
      tone: "muted",
      text: intl.formatMessage({ id: "cuaPermission.status.unknown" }),
    };
  };

  const renderRestartDetail = (): ReactNode => (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={restarting || !path}
        onClick={onManualRestart}
      >
        {restarting
          ? intl.formatMessage({ id: "cuaPermission.modal.restarting" })
          : intl.formatMessage({ id: "cuaPermission.modal.restartButton" })}
      </Button>
      {verifyTimedOut && !restarting ? (
        <div className="flex flex-col items-start gap-1">
          <span className="text-xs text-foreground-subtlest">
            {intl.formatMessage({ id: "cuaPermission.modal.relaunchAppHint" })}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => void onRelaunchApp()}>
            {intl.formatMessage({
              id: "cuaPermission.modal.relaunchAppButton",
            })}
          </Button>
        </div>
      ) : null}
    </div>
  );

  const acc = statusView(availableStatus?.accessibility);
  const screenPerm = statusView(availableStatus?.screenRecording);

  const { settings: appSettings, update: updateAppSettings } = useSettings();
  const [composerEntryHiddenOverride, setComposerEntryHiddenOverride] = useState<boolean | null>(
    null,
  );
  const [composerEntrySaving, setComposerEntrySaving] = useState(false);
  const persistedComposerEntryHidden = appSettings?.computerUseComposerEntryHidden !== false;
  const composerEntryVisible = !(composerEntryHiddenOverride ?? persistedComposerEntryHidden);
  useEffect(() => {
    if (composerEntryHiddenOverride === null) return;
    if (persistedComposerEntryHidden === composerEntryHiddenOverride) {
      setComposerEntryHiddenOverride(null);
    }
  }, [composerEntryHiddenOverride, persistedComposerEntryHidden]);
  const onToggleComposerEntry = useCallback(
    async (visible: boolean) => {
      const nextHidden = !visible;
      setComposerEntryHiddenOverride(nextHidden);
      setComposerEntrySaving(true);
      try {
        await updateAppSettings({ computerUseComposerEntryHidden: nextHidden });
      } catch (error) {
        if (mountedRef.current) {
          setComposerEntryHiddenOverride(null);
          toast(
            intl.formatMessage(
              { id: "settings.computerUse.composerEntry.saveFailed" },
              { error: error instanceof Error ? error.message : String(error) },
            ),
          );
        }
      } finally {
        if (mountedRef.current) setComposerEntrySaving(false);
      }
    },
    [intl, updateAppSettings],
  );

  const renderPermissionBadge = (
    kind: CuaPermissionKind,
    view: { tone: StatusDotTone; text: string },
    state: "granted" | "stale" | "denied" | "unknown" | undefined,
  ): ReactNode => {
    const clickable = state === "denied";
    const badge = (
      <SettingsBadge>
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={view.tone} />
          {view.text}
        </span>
      </SettingsBadge>
    );
    if (!clickable) return badge;
    return (
      <button
        type="button"
        className="cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={view.text}
        onClick={() => void openPermissionSettings(kind)}
      >
        {badge}
      </button>
    );
  };

  if (!supportsComputerUseSettings) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-ui-base text-warning">
        <p className="font-medium">
          {intl.formatMessage({ id: "settings.computerUse.unsupported.title" })}
        </p>
        <p className="mt-1 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({
            id: isComputerUseRemoteOrLinux(availability)
              ? availability.kind === "local-linux"
                ? "settings.computerUse.unsupported.linuxDescription"
                : "settings.computerUse.unsupported.remoteDescription"
              : "settings.computerUse.unsupported.remoteDescription",
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {}
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.computerUse.toggleLabel" })}
          description={intl.formatMessage({
            id: "settings.computerUse.toggleDescription",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({
                id: "settings.computerUse.toggleLabel",
              })}
              checked={cuaEnabled}
              disabled={cuaToggling || !workspacePath}
              onCheckedChange={(checked) => void onTogglePlugin(checked)}
            />
          }
        />
        {}
        <SettingsRow
          label={intl.formatMessage({ id: "settings.computerUse.composerEntry.label" })}
          description={intl.formatMessage({
            id: cuaEnabled
              ? "settings.computerUse.composerEntry.description"
              : "settings.computerUse.composerEntry.requiresEnabled",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({
                id: "settings.computerUse.composerEntry.label",
              })}
              checked={composerEntryVisible}
              disabled={composerEntrySaving || !cuaEnabled}
              onCheckedChange={(checked) => void onToggleComposerEntry(checked)}
            />
          }
        />
      </SettingsGroupCard>

      {}
      {cuaEnabled && supportsLocalMacWorkspace ? (
        <>
          {}
          {macOsBelowCuaFloor ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              <p className="font-medium">
                {intl.formatMessage(
                  { id: "cuaPermission.osFloorTitle" },
                  {
                    minimum: osSupport?.minimumMacOs ?? "12.0",
                    current: osSupport?.currentMacOs ?? "12 以下",
                  },
                )}
              </p>
              <p>{intl.formatMessage({ id: "cuaPermission.osFloorDescription" })}</p>
            </div>
          ) : null}
          {}
          {!macOsBelowCuaFloor ? (
            <SettingsGroupCard>
              <SettingsRow
                controlLayout="wide"
                label={intl.formatMessage({
                  id: "cuaPermission.perm.accessibility",
                })}
                description={intl.formatMessage({
                  id: "cuaPermission.perm.accessibility.purpose",
                })}
                control={renderPermissionBadge(
                  "accessibility",
                  acc,
                  availableStatus?.accessibility,
                )}
                detail={
                  availableStatus?.accessibility === "granted"
                    ? undefined
                    : availableStatus?.accessibility === "stale"
                      ? renderRestartDetail()
                      : renderGrantDetail("accessibility", "chat.cuaPermission.openAccessibility")
                }
              />
              <SettingsRow
                controlLayout="wide"
                label={intl.formatMessage({
                  id: "cuaPermission.perm.screenRecording",
                })}
                description={intl.formatMessage({
                  id: "cuaPermission.perm.screenRecording.purpose",
                })}
                control={renderPermissionBadge(
                  "screen_recording",
                  screenPerm,
                  availableStatus?.screenRecording,
                )}
                detail={
                  availableStatus?.screenRecording === "granted"
                    ? undefined
                    : renderGrantDetail(
                        "screen_recording",
                        "chat.cuaPermission.openScreenRecording",
                      )
                }
              />
            </SettingsGroupCard>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
