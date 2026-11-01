
import { useCallback, useEffect, useRef, useState } from "react";
import type { OAuthProviderId, OAuthProviderMeta } from "@origin-ai/cf-shared";
import {
  BIGMODEL_PROVIDER_ID,
  isCredentialDecryptError,
  resolveSafeTelemetryHostname,
  ZAI_PROVIDER_ID,
} from "@origin-ai/cf-shared";
import { reportAppTelemetryEvent } from "@/lib/appTelemetry.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import type { LoginEntryPurpose } from "@/store/index.js";
import { useCfStore } from "@/store/StoreProvider.js";
import { logger } from "../logger.js";
import { usePlatform } from "./usePlatform.js";
import { useServices } from "./useServices.js";

type OAuthStatus = "idle" | "waiting" | "error";

export function useOAuth() {
  const { oauthService } = useServices();
  const platform = usePlatform();
  const { intl } = useCfIntl();
  const [status, setStatus] = useState<OAuthStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<OAuthProviderMeta[]>([]);
  const [activeProvider, setActiveProvider] = useState<OAuthProviderId | null>(null);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [pendingProvider, setPendingProvider] = useState<OAuthProviderId | null>(null);
  const loginAttemptRef = useRef(0);
  const setOAuthPollingActive = useCfStore((state) => state.setOAuthPollingActive);

  const refreshProviders = useCallback(async () => {
    try {
      setLoadingProviders(true);
      const providerList = await oauthService.getProviders();
      setProviders(providerList);

      try {
        const active = await oauthService.getActiveProvider();
        setActiveProvider(active);
      } catch (err) {
        if (!isCredentialDecryptError(err)) {
          throw err;
        }

        logger.warn("[useOAuth] Failed to load active provider credentials; treated as not logged in:", err);
        setActiveProvider(null);
      }
    } catch (err) {
      logger.error("[useOAuth] 加载 provider 列表失败:", err);
      setProviders([]);
      setActiveProvider(null);
    } finally {
      setLoadingProviders(false);
    }
  }, [oauthService]);

  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  const startLogin = useCallback(
    async (provider: OAuthProviderId, options: { purpose?: LoginEntryPurpose } = {}) => {
      const loginAttempt = ++loginAttemptRef.current;
      try {
        setStatus("waiting");
        setError(null);
        setPendingProvider(provider);

        const {
          authorizeUrl,
          state,
          provider: startedProvider,
        } = await oauthService.startOAuthWithPolling(provider);

        if (loginAttemptRef.current !== loginAttempt) {
          return;
        }

        platform.registerOAuthState({ state, provider: startedProvider });
        setOAuthPollingActive(
          startedProvider === ZAI_PROVIDER_ID || startedProvider === BIGMODEL_PROVIDER_ID,
        );
        platform.openExternal(authorizeUrl);
        void reportAppTelemetryEvent(
          platform,
          {
            elementName: "app_login_ck",
            eventRegion: "app",
            eventType: "ck",
            eventExtraDetail: {
              login_url: resolveSafeTelemetryHostname(authorizeUrl),
            },
          },
          "useOAuth",
        );

        logger.info("[useOAuth] OAuth flow started, waiting for browser callback", {
          provider: startedProvider,
          purpose: options.purpose ?? "app-login",
        });
      } catch (err) {
        if (loginAttemptRef.current !== loginAttempt) {
          return;
        }
        logger.error("[useOAuth] Failed to initiate OAuth:", err);
        setOAuthPollingActive(false);
        setStatus("error");
        setError(intl.formatMessage({ id: "login.oauth.loginFailure" }));
        setPendingProvider(null);
      }
    },
    [intl, oauthService, platform, setOAuthPollingActive],
  );

  const cancel = useCallback(
    async (provider?: OAuthProviderId) => {
      loginAttemptRef.current += 1;
      await oauthService.cancelPending(provider);
      setOAuthPollingActive(false);
      setStatus("idle");
      setError(null);
      setPendingProvider(null);
    },
    [oauthService, setOAuthPollingActive],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setPendingProvider(null);
  }, []);

  
  const setOAuthError = useCallback((message: string) => {
    setStatus("error");
    setError(message);
    setPendingProvider(null);
  }, []);

  const setOAuthSuccess = useCallback(async () => {
    setStatus("idle");
    setError(null);
    setPendingProvider(null);
    await refreshProviders();
  }, [refreshProviders]);

  return {
    startLogin,
    cancel,
    reset,
    status,
    error,
    providers,
    activeProvider,
    loadingProviders,
    pendingProvider,
    refreshProviders,
    setOAuthError,
    setOAuthSuccess,
  };
}
