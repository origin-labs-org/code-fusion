import type { WebOAuthProviderId } from "./browserOAuthCredentialRepo.js";

type WebAuthLocale = "zh-CN" | "en-US";

interface WebAuthPageCopy {
  brand: string;
  loginTitle: string;
  loginDescription: string;
  loginAction: Record<WebOAuthProviderId, string>;
  loginRegion: Record<WebOAuthProviderId, string>;
  callbackTitle: string;
  callbackDescription: string;
  callbackErrorTitle: string;
  callbackErrorDescription: string;
  retryAction: string;
}

const WEB_AUTH_COPY = {
  "zh-CN": {
    brand: "CodeFusion",
    loginTitle: "登录后Continue使用 Web Remote控制",
    loginDescription: "Please select与电脑端E同的登录平台，并使用同One账Number。",
    loginAction: { zai: "Connect Z.ai Continue使用", bigmodel: "Connect BigModel Continue使用" },
    loginRegion: { zai: "全球", bigmodel: "Medium国" },
    callbackTitle: "In progressCompleted登录",
    callbackDescription: "请稍候，In progress校验Account identity。",
    callbackErrorTitle: "登录失败",
    callbackErrorDescription: "授权流程未Completed，请Log In Again。",
    retryAction: "Log In Again",
  },
  "en-US": {
    brand: "CodeFusion",
    loginTitle: "Sign In To Continue",
    loginDescription: "Choose the same sign-in provider and account as on your computer.",
    loginAction: { zai: "Connect to Z.ai", bigmodel: "Connect to BigModel" },
    loginRegion: { zai: "Global", bigmodel: "CN" },
    callbackTitle: "Finishing Sign-In",
    callbackDescription: "Verifying your account identity.",
    callbackErrorTitle: "Sign-In Failed",
    callbackErrorDescription: "The authorization flow did not complete. Sign in again.",
    retryAction: "Sign In Again",
  },
} satisfies Record<WebAuthLocale, WebAuthPageCopy>;

function resolveWebAuthLocale(language?: string): WebAuthLocale {
  const candidate =
    language ??
    document.documentElement.lang ??
    navigator.language ??
    navigator.languages?.[0] ??
    "";

  return candidate.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function getWebAuthCopy(locale: WebAuthLocale = resolveWebAuthLocale()): WebAuthPageCopy {
  return WEB_AUTH_COPY[locale];
}
