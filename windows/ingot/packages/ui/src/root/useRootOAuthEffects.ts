/* eslint-disable max-lines -- OAuth lifecycle effects intentionally share one coordination point. */
import { useEffect, useRef } from "react";
import type {
  IPlatformService,
  OAuthProviderId,
  OAuthSessionCallbackResult,
  UserInfo,
} from "@origin-ai/cf-shared";
import {
  resolveProviderFamilyDomainFromOAuthProvider,
  CF_JWT_INVALID_BROADCAST_CHANNEL,
} from "@origin-ai/cf-shared";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import { useAlertDialog } from "@/hooks/useAlertDialog.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { reportAppTelemetryEvent, resolveProviderTelemetryLabel } from "@/lib/appTelemetry.js";
import { logger } from "@/logger.js";
import { setProviderFamilyDomain } from "@/lib/providerFamilyDomainSettings.js";
import type { ModelProviderFamilyConnectionSelection } from "@/lib/modelProviderFamilyConnectionSelection.js";
import {
  refreshLatestModelProviderFamilySelectionAfterLogin,
  refreshRestoredOAuthProviderFamilyAfterStartup,
} from "@/root/oauthProviderFamilySelectionRefresh.js";
import {
  applyCachedOAuthSessionRestoreResult,
  requestOAuthReauthentication,
} from "@/root/oauthCachedSessionRestore.js";
import { shouldApplyOAuthPollingFailure } from "@/root/oauthLoginAttemptGuard.js";
import { useAccountConnectionLossNotification } from "@/root/useAccountConnectionLossNotification.js";

export { refreshRestoredOAuthProviderFamilyAfterStartup } from "@/root/oauthProviderFamilySelectionRefresh.js";

export async function handleOAuthCallbackSuccess(params: {
  result: OAuthSessionCallbackResult;
  platform: Pick<IPlatformService, "reportTelemetryEvent">;
  refreshLatestModelProviderFamilySelection?: (
    provider: OAuthProviderId,
  ) => Promise<ModelProviderFamilyConnectionSelection | null>;
  refreshAppSettings?: () => Promise<void>;
  refreshProviderState: () => Promise<void>;
  setProviderFamilyDomain: (provider: OAuthProviderId) => Promise<void>;
  setUser: (user: UserInfo | null) => void;
  setOAuthError: (error: string | null) => void;
}) {
  const loginProvider = resolveProviderTelemetryLabel(params.result.provider);
  params.setUser(params.result.userInfo);
  params.setOAuthError(null);
  let connectionInitialized = true;
  try {
    await params.setProviderFamilyDomain(params.result.provider);
  } catch (error) {
    connectionInitialized = false;
    logger.warn("[Root] Connection domain initialization not applied after OAuth sign-in", {
      provider: params.result.provider,
      error,
    });
  }
  if (params.refreshLatestModelProviderFamilySelection || !connectionInitialized) {
    let selection: ModelProviderFamilyConnectionSelection | null = null;
    try {
      if (connectionInitialized && params.refreshLatestModelProviderFamilySelection)
        selection = await params.refreshLatestModelProviderFamilySelection(params.result.provider);
    } catch (error) {
      logger.warn("[Root] Failed to refresh provider family selectedKey after OAuth sign-in", {
        provider: params.result.provider,
        error,
      });
    }
    const selectedConnection = selection ? JSON.stringify(selection) : "";
    if ((selection || !connectionInitialized) && params.refreshAppSettings) {
      try {
        await params.refreshAppSettings();
      } catch (error) {
        logger.warn("[Root] Failed to refresh App settings snapshot after OAuth sign-in", {
          provider: params.result.provider,
          selectedConnection,
          error,
        });
      }
    }
  }
  await params.refreshProviderState();
  if (loginProvider) {
    void reportAppTelemetryEvent(
      params.platform,
      {
        elementName: "app_login_success",
        eventRegion: "app_profile",
        eventType: "view",
        eventExtraDetail: {
          login_provider: loginProvider,
        },
      },
      "Root",
    );
  }
  logger.info("[Root] OAuth sign-in succeeded:", params.result.userInfo.username);
}

export function useRootOAuthEffects({
  accountIntentKey,
  platform,
  services,
  refreshProviderState,
  refreshAppSettings,
  setUser,
  setIsRestoringOAuthSession,
  setOAuthError,
  oauthPollingActive,
  setOAuthPollingActive,
  markOAuthSuccess,
  onReauthenticationRequired,
}: {
  accountIntentKey: string;
  platform: IPlatformService;
  services: IServiceAccessor;
  refreshProviderState: () => Promise<void>;
  refreshAppSettings?: () => Promise<void>;
  setUser: (user: UserInfo | null) => void;
  setIsRestoringOAuthSession: (restoring: boolean) => void;
  setOAuthError: (error: string | null) => void;
  oauthPollingActive: boolean;
  setOAuthPollingActive: (active: boolean) => void;
  markOAuthSuccess: (provider?: OAuthProviderId) => void;
  onReauthenticationRequired: () => void;
}) {
  useAccountConnectionLossNotification(services, accountIntentKey, refreshAppSettings);
  const requestAlert = useAlertDialog();
  const { intl } = useCfIntl();
  const oauthLoginSucceededRef = useRef(false);
  const oauthLoginSuccessInFlightRef = useRef(false);
  const oauthLoginSuccessOwnerRef = useRef<"polling" | "deep-link" | null>(null);

  useEffect(() => {
    let disposed = false;
    async function restoreOAuthSessionInBackground() {
      logger.info("[Root] Starting OAuth local session restoration in background");
      let hasRestoredUser = false;
      try {
        const result = await services.oauthService.restoreCachedSessionState();

        if (disposed) {
          return;
        }

        hasRestoredUser = await applyCachedOAuthSessionRestoreResult({
          result,
          setUser,
          requestAlert,
          onReauthenticationRequired,
          shouldReauthenticate: async () =>
            !disposed && (await services.oauthService.getActiveProvider()) === null,
          copy: {
            title: intl.formatMessage({ id: "login.expired.title" }),
            description: intl.formatMessage({ id: "login.expired.description" }),
            actionLabel: intl.formatMessage({ id: "login.expired.action" }),
          },
        });
      } catch (error) {
        logger.error("[Root] Failed to restore OAuth local sign-in state:", error);
        if (disposed) {
          return;
        }
      }

      setIsRestoringOAuthSession(false);

      try {
        if (hasRestoredUser) {
          const activeProvider = await services.oauthService.getActiveProvider();
          if (disposed) return;
          await refreshRestoredOAuthProviderFamilyAfterStartup({
            activeProvider,
            services,
            refreshAppSettings,
          });
        }

        await refreshProviderState();
      } catch (error) {
        logger.warn("[Root] Failed to refresh startup account configuration; continuing to monitor subsequent updates", { error });
      }
    }

    void restoreOAuthSessionInBackground();

    return () => {
      disposed = true;
    };
  }, [
    intl,
    onReauthenticationRequired,
    refreshAppSettings,
    refreshProviderState,
    requestAlert,
    services,
    setIsRestoringOAuthSession,
    setUser,
  ]);

  useEffect(() => {
    let disposed = false;
    let promptPending = false;
    const disposable = services.broadcastService.onMessage((message) => {
      if (message.channel !== CF_JWT_INVALID_BROADCAST_CHANNEL || disposed || promptPending) {
        return;
      }
      promptPending = true;
      void requestOAuthReauthentication({
        setUser,
        requestAlert,
        onReauthenticationRequired: () => {
          if (!disposed) onReauthenticationRequired();
        },
        shouldReauthenticate: async () =>
          !disposed && (await services.oauthService.getActiveProvider()) === null,
        copy: {
          title: intl.formatMessage({ id: "login.expired.title" }),
          description: intl.formatMessage({ id: "login.expired.description" }),
          actionLabel: intl.formatMessage({ id: "login.expired.action" }),
        },
      })
        .catch((error) => logger.error("[Root] 登录失效恢复提示失败", { error }))
        .finally(() => {
          promptPending = false;
        });
    });
    return () => {
      disposed = true;
      disposable.dispose();
    };
  }, [intl, onReauthenticationRequired, requestAlert, services.broadcastService, setUser]);

  useEffect(() => {
    if (!oauthPollingActive) {
      return;
    }
    oauthLoginSucceededRef.current = false;
    oauthLoginSuccessInFlightRef.current = false;
    oauthLoginSuccessOwnerRef.current = null;
    let pollInFlight = false;
    const pollTimer = window.setInterval(() => {
      if (pollInFlight) {
        return;
      }
      pollInFlight = true;
      void services.oauthService
        .pollPendingOAuth()
        .then(async (result) => {
          if (!result || result.kind !== "session") {
            return;
          }
          oauthLoginSuccessOwnerRef.current = "polling";
          oauthLoginSuccessInFlightRef.current = true;
          await handleOAuthCallbackSuccess({
            result,
            platform,
            refreshLatestModelProviderFamilySelection: (provider) =>
              refreshLatestModelProviderFamilySelectionAfterLogin({ provider, services }),
            refreshAppSettings,
            refreshProviderState,
            setProviderFamilyDomain: async (provider) => {
              const domain = resolveProviderFamilyDomainFromOAuthProvider(provider);
              if (domain) {
                await setProviderFamilyDomain(services.settingService, domain);
              }
            },
            setUser,
            setOAuthError,
          });
          oauthLoginSucceededRef.current = true;
          oauthLoginSuccessOwnerRef.current = null;
          oauthLoginSuccessInFlightRef.current = false;
          markOAuthSuccess(result.provider);
          setOAuthPollingActive(false);
        })
        .catch((error) => {
          setOAuthPollingActive(false);
          const ownSuccessHandlerFailed = oauthLoginSuccessOwnerRef.current === "polling";
          if (ownSuccessHandlerFailed) {
            oauthLoginSuccessOwnerRef.current = null;
            oauthLoginSuccessInFlightRef.current = false;
          }
          const shouldApplyFailure = shouldApplyOAuthPollingFailure(
            oauthLoginSucceededRef.current,
            ownSuccessHandlerFailed ? false : oauthLoginSuccessInFlightRef.current,
          );
          logger.warn("[Root] OAuth polling determined as failed", {
            succeeded: oauthLoginSucceededRef.current,
            successInFlight: oauthLoginSuccessInFlightRef.current,
            shouldApplyFailure,
          });
          if (shouldApplyFailure) {
            setOAuthError(intl.formatMessage({ id: "login.oauth.loginFailure" }));
          }
          logger.error("[Root] Failed to handle OAuth polling:", error);
        })
        .finally(() => {
          pollInFlight = false;
        });
    }, 1_000);

    return () => {
      window.clearInterval(pollTimer);
    };
  }, [
    intl,
    markOAuthSuccess,
    oauthPollingActive,
    platform,
    refreshAppSettings,
    refreshProviderState,
    services,
    setOAuthError,
    setOAuthPollingActive,
    setUser,
  ]);

  useEffect(() => {
    const disposeOAuth = platform.onOAuthCallback(async (url) => {
      try {
        const result = await services.oauthService.handleCallback(url);
        if (!result) {
          logger.info("[Root] Ignored invalid OAuth callback");
          return;
        }
        if (result.kind === "attribution") {
          logger.info("[Root] Cached OAuth login attribution parameters:", result.provider);
          return;
        }
        if (result.kind === "duplicate") {
          logger.info("[Root] Ignored late OAuth deep link after polling completed");
          return;
        }

        oauthLoginSuccessOwnerRef.current = "deep-link";
        oauthLoginSuccessInFlightRef.current = true;
        await handleOAuthCallbackSuccess({
          result,
          platform,
          refreshLatestModelProviderFamilySelection: (provider) =>
            refreshLatestModelProviderFamilySelectionAfterLogin({
              provider,
              services,
            }),
          refreshAppSettings,
          refreshProviderState,
          setProviderFamilyDomain: async (provider) => {
            const domain = resolveProviderFamilyDomainFromOAuthProvider(provider);
            if (!domain) {
              return;
            }
            await setProviderFamilyDomain(services.settingService, domain);
          },
          setUser,
          setOAuthError,
        });
        oauthLoginSucceededRef.current = true;
        oauthLoginSuccessOwnerRef.current = null;
        oauthLoginSuccessInFlightRef.current = false;
        setOAuthPollingActive(false);
        markOAuthSuccess(result.provider);
      } catch (err) {
        const ownSuccessHandlerFailed = oauthLoginSuccessOwnerRef.current === "deep-link";
        if (ownSuccessHandlerFailed) {
          oauthLoginSuccessOwnerRef.current = null;
          oauthLoginSuccessInFlightRef.current = false;
        }
        const shouldApplyFailure = ownSuccessHandlerFailed
          ? !oauthLoginSucceededRef.current
          : shouldApplyOAuthPollingFailure(
              oauthLoginSucceededRef.current,
              oauthLoginSuccessInFlightRef.current,
            ) && !oauthPollingActive;
        logger.warn("[Root] OAuth deep link determined as failed", {
          succeeded: oauthLoginSucceededRef.current,
          successInFlight: oauthLoginSuccessInFlightRef.current,
          pollingActive: oauthPollingActive,
          shouldApplyFailure,
        });
        if (shouldApplyFailure) {
          setOAuthError(intl.formatMessage({ id: "login.oauth.loginFailure" }));
        }
        logger.error("[Root] OAuth 回调处理失败:", err);
      }
    });
    platform.notifyRendererReady();
    return () => {
      disposeOAuth();
    };
  }, [
    intl,
    platform,
    refreshAppSettings,
    refreshProviderState,
    services,
    markOAuthSuccess,
    oauthPollingActive,
    setUser,
    setOAuthError,
    setOAuthPollingActive,
  ]);
}
