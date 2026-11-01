import { createRoot } from "react-dom/client";
import "../../share-ui/src/styles.css";
import { applyTheme, type Theme } from "../../ui/src/useTheme.js";
import {
  ConversationShareLandingLoader,
  ConversationShareLandingStatus,
} from "../../web/src/share/ConversationShareLandingPage.js";
import {
  ConversationSharePreviewClient,
  resolveConversationShareRouteLocale,
} from "../../web/src/share/conversationSharePreviewClient.js";
import {
  isConversationSharePath,
  resolveConversationShareCodeFromPath,
} from "../../web/src/share/conversationShareRoute.js";
import { resolveWebRemoteControlInitialTheme } from "../../web/src/web-remote-control/adapters/webRemoteControlThemeSeed.js";
import { createWebAuthService } from "../../web/src/auth/webAuthService.js";
import {
  WEB_ZAI_OAUTH_CONFIG,
  resolveWebAuthDevReturnTo,
} from "../../web/src/auth/webZaiOAuthConfig.js";
import { parseOAuthState, resolveSafeAppReturnTo } from "../../web/src/auth/oauthStateCodec.js";
import { ShareCallbackPage } from "./ShareAuthPages.js";

const root = createRoot(document.getElementById("root")!);
const webAuthService = createWebAuthService();

function resolveThemePreference(): Theme {
  const saved = localStorage.getItem("cf-theme");
  return resolveWebRemoteControlInitialTheme({ storedTheme: saved, defaultTheme: "cf-light" });
}

const INITIAL_THEME = resolveThemePreference();
applyTheme(INITIAL_THEME);

function isOAuthCallback(): boolean {
  return (
    window.location.pathname === "/cn/share/callback" ||
    window.location.pathname === "/share/callback"
  );
}

function renderCallback(): void {
  const state = parseOAuthState(new URLSearchParams(window.location.search).get("state") ?? "");
  const retryTarget = resolveSafeAppReturnTo(state?.app_return_to) ?? "/share";
  root.render(
    <ShareCallbackPage
      authService={webAuthService}
      onSuccess={({ appReturnTo }) => window.location.replace(appReturnTo ?? "/share")}
      onRetry={() => window.location.replace(retryTarget)}
    />,
  );
}

async function renderShare(): Promise<void> {
  const locale = resolveConversationShareRouteLocale(window.location.pathname);
  document.documentElement.lang = locale;
  document.title = locale === "zh-CN" ? "CodeFusion Session Sharing" : "CodeFusion Conversation Share";

  const shareCode = resolveConversationShareCodeFromPath(window.location.pathname);
  if (!shareCode) {
    root.render(
      <ConversationShareLandingStatus
        state={{ kind: "error", error: "invalid_contract" }}
        locale={locale}
      />,
    );
    return;
  }

  const endpointOrigin =
    import.meta.env.VITE_CF_BASE_URL?.trim().replace(/\/+$/u, "") || window.location.origin;
  const mockMode =
    import.meta.env.DEV && import.meta.env.VITE_CONVERSATION_SHARE_PREVIEW_MOCK === "true";
  const client = mockMode
    ? new (
        await import("../../web/src/share/mockConversationSharePreviewClient.js")
      ).MockConversationSharePreviewClient()
    : new ConversationSharePreviewClient({ baseUrl: `${endpointOrigin}/api/v1` });
  const getMockToken = () =>
    mockMode && window.sessionStorage.getItem("cf:share:mock-auth") === "owner"
      ? "mock-owner-token"
      : null;

  root.render(
    <ConversationShareLandingLoader
      shareCode={shareCode}
      client={client}
      getAccessToken={() => getMockToken() ?? webAuthService.getCfJwtToken()}
      onLogin={(provider) => {
        if (mockMode) {
          window.sessionStorage.setItem("cf:share:mock-auth", "owner");
          window.location.reload();
          return;
        }
        webAuthService.startLogin({
          provider,
          appReturnTo: window.location.href,
          redirectUri: WEB_ZAI_OAUTH_CONFIG.shareRedirectUri,
          devReturnTo: resolveWebAuthDevReturnTo(WEB_ZAI_OAUTH_CONFIG, "share"),
        });
      }}
      onLogout={() => {
        if (mockMode) window.sessionStorage.removeItem("cf:share:mock-auth");
        void webAuthService.logout();
        window.location.reload();
      }}
      locale={locale}
      theme={INITIAL_THEME}
    />,
  );
}

async function main(): Promise<void> {
  if (isOAuthCallback()) {
    renderCallback();
    return;
  }
  if (isConversationSharePath(window.location.pathname)) {
    await renderShare();
    return;
  }
  root.render(
    <ConversationShareLandingStatus state={{ kind: "error", error: "invalid_contract" }} />,
  );
}

void main();
