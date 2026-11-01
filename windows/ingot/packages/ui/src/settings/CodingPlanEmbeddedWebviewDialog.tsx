
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { usePlatform } from "@/hooks/usePlatform.js";
import { RENDERER_CF_ENDPOINT_URLS } from "@/lib/rendererCfEndpoint.js";
import { logger } from "@/logger.js";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { EmbeddedWebsiteHeader } from "@/components/EmbeddedWebsiteHeader.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";
import { normalizeThemePreference, resolveTheme } from "@/useTheme.js";
import type { CodingPlanProviderId } from "@/settings/model-provider-section/constants.js";
import type { CodingPlanFunnelContext } from "@/lib/codingPlanFunnelTelemetry.js";
import {
  buildCodingPlanEmbeddedWebviewUrl,
  buildCodingPlanEmbeddedReportContext,
  createCodingPlanAuthInjectionScript,
  createCodingPlanCredentialClearScript,
  createCodingPlanLangInjectionScript,
  createCodingPlanScrollbarHideScript,
  getCodingPlanCredentialKeys,
  isTrustedCodingPlanEmbeddedWebviewUrl,
  resolveCodingPlanEmbeddedOrigin,
  resolveCodingPlanWebsiteProvider,
  type CodingPlanEmbeddedCredentials,
  type CodingPlanEmbeddedTheme,
  type CodingPlanPurchaseAudience,
  CODING_PLAN_WEBVIEW_OVERRIDE_ENV_KEY,
} from "@/settings/model-provider-section/codingPlanEmbeddedWebview.js";
import {
  CodingPlanWebviewChannels,
  type CodingPlanPurchaseCompletePayload,
  CF_ENV,
  CF_VERSION,
} from "@origin-ai/cf-shared";

interface CodingPlanEmbeddedWebviewDialogProps {
  credentialService: {
    load(key: string): Promise<string | null>;
  };
  onOpenChange: (open: boolean) => void;
  open: boolean;
  onOpenResult?: (opened: boolean) => void;
  providerId: CodingPlanProviderId;
  funnelContext?: CodingPlanFunnelContext | null;
  audience?: CodingPlanPurchaseAudience;
  teamPlanKey?: string | null;
  
  onPurchaseComplete?: () => void;
}

interface CodingPlanWebviewImportMetaEnv {
  DEV?: boolean;
  VITE_CODING_PLAN_WEBVIEW_ORIGIN?: string;
  VITE_CF_E2E_STORE_BRIDGE?: string;
}

interface CodingPlanWebviewNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

function readCodingPlanWebviewImportMetaEnv(): CodingPlanWebviewImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: CodingPlanWebviewImportMetaEnv }).env ??
    {}) as CodingPlanWebviewImportMetaEnv;
}

export function CodingPlanEmbeddedWebviewDialog({
  credentialService,
  onOpenChange,
  open,
  providerId,
  funnelContext,
  audience,
  teamPlanKey,
  onPurchaseComplete,
  onOpenResult,
}: CodingPlanEmbeddedWebviewDialogProps) {
  const { intl, locale } = useCfIntl();
  const platform = usePlatform();
  const theme = useCfStoreWithDefault((state) => state.theme, "cf-dark");
  const userId = useCfStoreWithDefault((state) => state.user?.id ?? null, null);
  const webviewRef = useRef<ElectronWebviewTag | null>(null);
  const onOpenResultRef = useRef(onOpenResult);
  onOpenResultRef.current = onOpenResult;
  const webviewLocale = locale;
  const webviewCleanupRef = useRef<(() => void) | null>(null);
  const webviewReadyRef = useRef(false);
  const frozenWebviewUrlRef = useRef<string | null>(null);
  const injectAuthRef = useRef<(webview: ElectronWebviewTag | null) => Promise<void>>(
    async () => {},
  );
  const onPurchaseCompleteRef = useRef<(() => void) | undefined>(onPurchaseComplete);
  useEffect(() => {
    onPurchaseCompleteRef.current = onPurchaseComplete;
  }, [onPurchaseComplete]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [navigationState, setNavigationState] = useState<CodingPlanWebviewNavigationState>({
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
  });
  const provider = resolveCodingPlanWebsiteProvider(providerId);
  const embeddedTheme: CodingPlanEmbeddedTheme =
    normalizeThemePreference(theme) === "cf-dark" || resolveTheme(theme) === "dark"
      ? "cf-dark"
      : "cf-light";
  const computedWebviewUrl = useMemo(() => {
    const env = readCodingPlanWebviewImportMetaEnv();
    const origin = resolveCodingPlanEmbeddedOrigin({
      dev: env.DEV === true,
      endpointOrigin: RENDERER_CF_ENDPOINT_URLS.origin,
      e2eStoreBridgeEnabled: env.VITE_CF_E2E_STORE_BRIDGE === "1",
      overrideOrigin: env.VITE_CODING_PLAN_WEBVIEW_ORIGIN,
      cfEnv: CF_ENV,
    });
    return buildCodingPlanEmbeddedWebviewUrl({
      origin,
      provider,
      locale: webviewLocale,
      theme: embeddedTheme,
      audience,
      teamPlanKey,
    });
  }, [audience, embeddedTheme, provider, teamPlanKey, webviewLocale]);
  if (open && frozenWebviewUrlRef.current === null) {
    frozenWebviewUrlRef.current = computedWebviewUrl;
  } else if (!open && frozenWebviewUrlRef.current !== null) {
    frozenWebviewUrlRef.current = null;
  }
  const webviewUrl = frozenWebviewUrlRef.current ?? computedWebviewUrl;

  const injectAuth = useCallback(
    async (webview: ElectronWebviewTag | null = webviewRef.current) => {
      if (!webview) {
        return;
      }
      setAuthError(null);
      try {
        const env = readCodingPlanWebviewImportMetaEnv();
        const currentUrl = typeof webview.getURL === "function" ? webview.getURL() : "";
        if (
          !isTrustedCodingPlanEmbeddedWebviewUrl(currentUrl, {
            e2eStoreBridgeEnabled: env.VITE_CF_E2E_STORE_BRIDGE === "1",
          })
        ) {
          await webview.executeJavaScript(createCodingPlanCredentialClearScript(), true);
          return;
        }
        const keys = getCodingPlanCredentialKeys(provider);
        const [values, deviceMid] = await Promise.all([
          Promise.all(keys.map((key) => credentialService.load(key))),
          Promise.resolve()
            .then(() => platform.getDeviceId())
            .catch(() => null),
        ]);
        const credentials: CodingPlanEmbeddedCredentials =
          provider === "zai"
            ? {
                zaiAccessToken: values[0],
                cfJwtToken: values[1],
              }
            : {
                bigmodelAccessToken: values[0],
                cfJwtToken: values[1],
              };
        const reportContext = buildCodingPlanEmbeddedReportContext({
          funnelContext,
          deviceMid,
          userId,
          appVersion: CF_VERSION,
        });
        const script = createCodingPlanAuthInjectionScript({
          provider,
          credentials,
          theme: embeddedTheme,
          locale: webviewLocale,
          reportContext,
        });
        await webview.executeJavaScript(
          `${createCodingPlanCredentialClearScript()};\n${script}`,
          true,
        );
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : String(error));
        logger.warn("[CodingPlanEmbeddedWebviewDialog] 注入购买凭据失败", {
          provider,
          error,
        });
      }
    },
    [credentialService, embeddedTheme, funnelContext, platform, provider, userId, webviewLocale],
  );

  useEffect(() => {
    if (!open) return;
    if (!webviewReadyRef.current) return;
    const webview = webviewRef.current;
    if (!webview) return;
    const script = createCodingPlanLangInjectionScript(webviewLocale);
    void webview.executeJavaScript(script, true).catch(() => {
    });
  }, [open, webviewLocale]);

  useEffect(() => {
    injectAuthRef.current = injectAuth;
  }, [injectAuth]);

  const syncNavigationState = useCallback((webview: ElectronWebviewTag | null) => {
    if (!webview) {
      setNavigationState({
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
      });
      return;
    }
    try {
      setNavigationState((current) => ({
        ...current,
        canGoBack: webview.canGoBack(),
        canGoForward: webview.canGoForward(),
      }));
    } catch (error) {
      logger.debug("[CodingPlanEmbeddedWebviewDialog] 同步 webview 导航状态失败", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const handleGoBack = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview || !navigationState.canGoBack) return;
    webview.goBack();
    syncNavigationState(webview);
  }, [navigationState.canGoBack, syncNavigationState]);

  const handleGoForward = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview || !navigationState.canGoForward) return;
    webview.goForward();
    syncNavigationState(webview);
  }, [navigationState.canGoForward, syncNavigationState]);

  const handleReloadWebview = useCallback(() => {
    webviewRef.current?.reload();
  }, []);

  const handleWebviewRef = useCallback(
    (element: ElectronWebviewTag | null) => {
      webviewCleanupRef.current?.();
      webviewCleanupRef.current = null;
      webviewRef.current = element;
      if (!element) {
        webviewReadyRef.current = false;
        setNavigationState({
          canGoBack: false,
          canGoForward: false,
          isLoading: false,
        });
        return;
      }
      const handleDomReady = () => {
        webviewReadyRef.current = true;
        syncNavigationState(element);
        void element
          .executeJavaScript(createCodingPlanScrollbarHideScript(), true)
          .catch((error) => {
            logger.debug("[CodingPlanEmbeddedWebviewDialog] 隐藏 webview 滚动条失败", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        void injectAuthRef.current(element);
        onOpenResultRef.current?.(true);
      };
      const handleDidStartLoading = () => {
        webviewReadyRef.current = false;
        setAuthError(null);
        setLoadError(null);
        setNavigationState((current) => ({ ...current, isLoading: true }));
      };
      const handleDidStopLoading = () => {
        setNavigationState((current) => ({ ...current, isLoading: false }));
        syncNavigationState(element);
      };
      const handleNavigation = () => {
        syncNavigationState(element);
      };
      const handleDidFailLoad = (event: ElectronWebviewDidFailLoadEvent) => {
        if (!event.isMainFrame) {
          return;
        }
        const description = event.errorDescription || String(event.errorCode);
        logger.warn("[CodingPlanEmbeddedWebviewDialog] Failed to load webview", {
          provider,
          errorCode: event.errorCode,
          errorDescription: event.errorDescription,
          validatedURL: event.validatedURL,
        });
        setLoadError(description);
        onOpenResultRef.current?.(false);
        setNavigationState((current) => ({ ...current, isLoading: false }));
      };
      const handleRenderProcessGone = (event: ElectronWebviewRenderProcessGoneEvent) => {
        logger.warn("[CodingPlanEmbeddedWebviewDialog] webview render process crashed", {
          provider,
          reason: event.details.reason,
          exitCode: event.details.exitCode,
        });
        setLoadError(event.details.reason);
        onOpenResultRef.current?.(false);
      };
      const handleIpcMessage = (event: ElectronWebviewIpcMessageEvent) => {
        if (event.channel !== CodingPlanWebviewChannels.PurchaseComplete) {
          return;
        }
        const raw = event.args[0] as CodingPlanPurchaseCompletePayload | undefined;
        if (raw?.provider !== "zai" && raw?.provider !== "bigmodel") {
          logger.warn("[CodingPlanEmbeddedWebviewDialog] 收到非法的购买完成 payload", {
            channel: event.channel,
            args: event.args,
          });
          return;
        }
        logger.info("[CodingPlanEmbeddedWebviewDialog] 收到官网购买完成信号，触发刷新", {
          provider: raw.provider,
          timestamp: raw.timestamp,
        });
        onPurchaseCompleteRef.current?.();
      };

      element.addEventListener("dom-ready", handleDomReady);
      element.addEventListener("did-start-loading", handleDidStartLoading);
      element.addEventListener("did-stop-loading", handleDidStopLoading);
      element.addEventListener("did-navigate", handleNavigation);
      element.addEventListener("did-navigate-in-page", handleNavigation);
      element.addEventListener("did-fail-load", handleDidFailLoad);
      element.addEventListener("render-process-gone", handleRenderProcessGone);
      element.addEventListener("ipc-message", handleIpcMessage);
      webviewCleanupRef.current = () => {
        webviewReadyRef.current = false;
        element.removeEventListener("dom-ready", handleDomReady);
        element.removeEventListener("did-start-loading", handleDidStartLoading);
        element.removeEventListener("did-stop-loading", handleDidStopLoading);
        element.removeEventListener("did-navigate", handleNavigation);
        element.removeEventListener("did-navigate-in-page", handleNavigation);
        element.removeEventListener("did-fail-load", handleDidFailLoad);
        element.removeEventListener("render-process-gone", handleRenderProcessGone);
        element.removeEventListener("ipc-message", handleIpcMessage);
      };
    },
    [syncNavigationState],
  );

  useEffect(() => {
    return () => {
      const webview = webviewRef.current;
      if (webviewReadyRef.current && webview) {
        void webview.executeJavaScript(createCodingPlanCredentialClearScript(), true).catch(() => {
        });
      }
      webviewCleanupRef.current?.();
      webviewCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (open) {
      setAuthError(null);
      setLoadError(null);
      setNavigationState({
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
      });
    }
  }, [open, webviewUrl]);

  const handleOpenWebsite = useCallback(() => {
    platform.openExternal(webviewUrl);
  }, [platform, webviewUrl]);

  if (!open) {
    return null;
  }

  const pageContentWidthClass = "max-w-5xl";

  return (
    <section
      data-testid="coding-plan-upgrade-surface"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background pt-12 text-foreground"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <EmbeddedWebsiteHeader
          title={intl.formatMessage({ id: "settings.modelProvider.codingPlan.webview.title" })}
          loading={navigationState.isLoading}
          canGoBack={navigationState.canGoBack}
          canGoForward={navigationState.canGoForward}
          onBack={handleGoBack}
          onForward={handleGoForward}
          onReload={handleReloadWebview}
          onClose={() => onOpenChange(false)}
        />

        <main
          className={cn(
            "mx-auto flex w-full flex-1 flex-col px-6 pt-2 pb-8 max-sm:px-4 max-sm:pt-2 max-sm:pb-5",
            pageContentWidthClass,
          )}
        >
          {authError ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 text-ui-base text-foreground-subtle">
              <span>
                {intl.formatMessage({
                  id: "settings.modelProvider.codingPlan.webview.authInjectFailed",
                })}
              </span>
              <Button size="sm" variant="outline" onClick={() => void injectAuth()}>
                <RefreshCwIcon className="size-3.5" />
                {intl.formatMessage({
                  id: "settings.modelProvider.codingPlan.webview.retry",
                })}
              </Button>
            </div>
          ) : null}
          {loadError ? (
            <div
              className="mb-3 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-ui-base text-foreground-subtle"
              data-testid="coding-plan-embedded-webview-load-error"
            >
              <span className="font-medium text-foreground">
                {intl.formatMessage({
                  id: "settings.modelProvider.codingPlan.webview.loadFailed",
                })}
              </span>
              <span className="text-ui-sm text-foreground-subtle">{loadError}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleOpenWebsite}>
                  <ExternalLinkIcon className="size-3.5" />
                  {intl.formatMessage({
                    id: "settings.modelProvider.codingPlan.webview.openWebsite",
                  })}
                </Button>
                <Button size="sm" variant="ghost" onClick={handleReloadWebview}>
                  <RefreshCwIcon className="size-3.5" />
                  {intl.formatMessage({
                    id: "settings.modelProvider.codingPlan.webview.retry",
                  })}
                </Button>
              </div>
            </div>
          ) : null}
          <webview
            ref={handleWebviewRef}
            allowpopups={"" as unknown as boolean}
            partition="persist:cf-coding-plan"
            src={webviewUrl}
            className={cn(
              "min-h-0 flex-1 bg-background [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              loadError && "hidden",
            )}
            data-testid="coding-plan-embedded-webview"
          />
        </main>
      </div>
    </section>
  );
}

export { CODING_PLAN_WEBVIEW_OVERRIDE_ENV_KEY };
