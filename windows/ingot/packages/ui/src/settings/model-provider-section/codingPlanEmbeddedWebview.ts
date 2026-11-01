import {
  BIGMODEL_PROVIDER_ID,
  BUILTIN_MODEL_PROVIDER_IDS,
  DEFAULT_CF_ENDPOINT_ORIGIN,
  isTrustedCodingPlanWebviewOrigin,
  isZaiCodingPlanProviderId,
  normalizeCfEndpointOrigin,
  type CfEnv,
  CF_ENV,
  ZAI_PROVIDER_ID,
} from "@origin-ai/cf-shared";
import type { CodingPlanWebviewLocale } from "@origin-ai/cf-shared";
import type { CodingPlanFunnelContext } from "@/lib/codingPlanFunnelTelemetry.js";
import type { CodingPlanProviderId } from "@/settings/model-provider-section/constants.js";

export type CodingPlanWebsiteProvider = "zai" | "bigmodel";
export type CodingPlanPurchaseAudience = "personal" | "team";

export interface CodingPlanEmbeddedCredentials {
  zaiAccessToken?: string | null;
  cfJwtToken?: string | null;
  bigmodelAccessToken?: string | null;
}

export interface CodingPlanEmbeddedReportContext {
  purchase_funnel_id?: string;
  purchase_entry_reporter?: "app";
  upgrade_source?: string;
  event_region?: string;
  event_text?: string;
  entry_plan_status?: string;
  entry_plan_level?: string;
  entry_plan_list?: string;
  purchase_audience?: string;
  provider_family?: string;
  channel?: string;
  device_mid?: string;
  user_id?: string;
  app_version?: string;
}

export type CodingPlanEmbeddedTheme = "cf-light" | "cf-dark";

export function codingPlanLocaleToWebsiteLang(
  locale: CodingPlanWebviewLocale | null | undefined,
): "cn" | "en" {
  return locale === "zh-CN" ? "cn" : "en";
}

export interface ResolveCodingPlanEmbeddedOriginOptions {
  dev: boolean;
  endpointOrigin: string;
  e2eStoreBridgeEnabled?: boolean;
  overrideOrigin?: string | null;
  cfEnv?: CfEnv;
}

export const CODING_PLAN_WEBVIEW_OVERRIDE_ENV_KEY = "VITE_CODING_PLAN_WEBVIEW_ORIGIN";
const CODING_PLAN_WEBVIEW_CREDENTIAL_LOCAL_STORAGE_KEYS = [
  "oauth:zai:access_token",
  "cfjwttoken",
  "oauth:bigmodel:access_token",
] as const;
const CODING_PLAN_REPORT_CONTEXT_STORAGE_KEY = "cf:coding-plan:report-context";

export function resolveCodingPlanWebsiteProvider(
  providerId: CodingPlanProviderId,
): CodingPlanWebsiteProvider {
  return isZaiCodingPlanProviderId(providerId) ||
    providerId === BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan
    ? "zai"
    : "bigmodel";
}

export function resolveCodingPlanEmbeddedOrigin({
  dev,
  endpointOrigin,
  e2eStoreBridgeEnabled,
  overrideOrigin,
  cfEnv = CF_ENV,
}: ResolveCodingPlanEmbeddedOriginOptions): string {
  const normalizedOverride = overrideOrigin?.trim();
  if (
    normalizedOverride &&
    isTrustedCodingPlanWebviewOrigin(normalizedOverride, { e2eStoreBridgeEnabled })
  ) {
    return normalizeCfEndpointOrigin(normalizedOverride);
  }
  if (dev && cfEnv === "test") {
    return "http://localhost:3000";
  }
  const normalizedEndpointOrigin = normalizeCfEndpointOrigin(endpointOrigin);
  return isTrustedCodingPlanWebviewOrigin(normalizedEndpointOrigin, { e2eStoreBridgeEnabled })
    ? normalizedEndpointOrigin
    : DEFAULT_CF_ENDPOINT_ORIGIN;
}

export function buildCodingPlanEmbeddedWebviewUrl({
  origin,
  provider,
  locale,
  theme,
  audience,
  teamPlanKey,
}: {
  origin: string;
  provider: CodingPlanWebsiteProvider;
  locale?: CodingPlanWebviewLocale | null;
  theme?: CodingPlanEmbeddedTheme | null;
  audience?: CodingPlanPurchaseAudience;
  teamPlanKey?: string | null;
}): string {
  const url = new URL("/coding-plan", normalizeCfEndpointOrigin(origin));
  url.searchParams.set("provider", provider);
  url.searchParams.set("embedded", "app");
  url.searchParams.set("lang", codingPlanLocaleToWebsiteLang(locale));
  if (audience) {
    url.searchParams.set("audience", audience);
  }
  if (teamPlanKey?.trim()) {
    url.searchParams.set("teamPlanKey", teamPlanKey.trim());
  }
  if (theme) {
    url.searchParams.set("theme", theme);
  }
  return url.toString();
}

export function isTrustedCodingPlanEmbeddedWebviewUrl(
  value: string | null | undefined,
  options?: {
    e2eStoreBridgeEnabled?: boolean;
  },
): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (
      !isTrustedCodingPlanWebviewOrigin(url.origin, {
        e2eStoreBridgeEnabled: options?.e2eStoreBridgeEnabled,
      })
    ) {
      return false;
    }
    if (!url.pathname.includes("coding-plan")) return false;
    if (url.searchParams.get("embedded") === "app") return true;
    if (!url.pathname.endsWith("/coding-plan/payment/callback")) return false;
    const returnTo = url.searchParams.get("returnTo");
    if (!returnTo) return false;
    const target = new URL(returnTo, url.origin);
    return (
      target.origin === url.origin &&
      target.pathname.includes("coding-plan") &&
      target.searchParams.get("embedded") === "app" &&
      !target.pathname.endsWith("/coding-plan/payment/callback")
    );
  } catch {
    return false;
  }
}

export function createCodingPlanAuthInjectionScript({
  provider,
  credentials,
  theme,
  locale,
  reportContext,
}: {
  provider: CodingPlanWebsiteProvider;
  credentials: CodingPlanEmbeddedCredentials;
  theme: CodingPlanEmbeddedTheme;
  locale: CodingPlanWebviewLocale | null;
  reportContext?: CodingPlanEmbeddedReportContext | null;
}): string {
  const values: Record<string, string | null> =
    provider === "zai"
      ? {
          "oauth:zai:access_token": credentials.zaiAccessToken?.trim() || null,
          cfjwttoken: credentials.cfJwtToken?.trim() || null,
          "oauth:bigmodel:access_token": null,
        }
      : {
          "oauth:zai:access_token": null,
          cfjwttoken: credentials.cfJwtToken?.trim() || null,
          "oauth:bigmodel:access_token": credentials.bigmodelAccessToken?.trim() || null,
        };
  const storageUpdates = Object.entries(values)
    .map(([key, value]) =>
      value
        ? `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`
        : `localStorage.removeItem(${JSON.stringify(key)});`,
    )
    .join("\n  ");
  const resolvedLocale: CodingPlanWebviewLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
  const normalizedReportContext = normalizeCodingPlanEmbeddedReportContext(reportContext);

  return `(() => {
  ${storageUpdates}
  const cfTheme = ${JSON.stringify(theme)};
  document.documentElement.classList.toggle("dark", cfTheme === "cf-dark");
  document.documentElement.classList.toggle("theme-cf-light", cfTheme === "cf-light");
  document.documentElement.classList.toggle("theme-cf-dark", cfTheme === "cf-dark");
  localStorage.setItem("cf-theme", cfTheme);
  localStorage.setItem("cf:coding-plan:embedded", "app");
  window.__cfLang__ = ${JSON.stringify(resolvedLocale)};
  const cfReportContext = ${JSON.stringify(normalizedReportContext)};
  window.__cfReportContext__ = cfReportContext;
  localStorage.setItem(${JSON.stringify(CODING_PLAN_REPORT_CONTEXT_STORAGE_KEY)}, JSON.stringify(cfReportContext));
  window.dispatchEvent(new CustomEvent("cf-coding-plan-auth-ready", {
    detail: { ...${JSON.stringify({ provider, locale: resolvedLocale })}, reportContext: cfReportContext },
  }));
})()`;
}

export function buildCodingPlanEmbeddedReportContext({
  funnelContext,
  deviceMid,
  userId,
  appVersion,
}: {
  funnelContext?: CodingPlanFunnelContext | null;
  deviceMid?: string | null;
  userId?: string | null;
  appVersion?: string | null;
}): CodingPlanEmbeddedReportContext {
  return normalizeCodingPlanEmbeddedReportContext({
    purchase_funnel_id: funnelContext?.purchaseFunnelId,
    purchase_entry_reporter: funnelContext ? "app" : undefined,
    upgrade_source: funnelContext?.upgradeSource,
    event_region: funnelContext?.eventRegion,
    event_text: funnelContext?.eventText,
    entry_plan_status: funnelContext?.entryPlanStatus,
    entry_plan_level: funnelContext?.entryPlanLevel,
    entry_plan_list: funnelContext?.entryPlanList,
    purchase_audience: funnelContext?.purchaseAudience,
    provider_family: funnelContext?.providerFamily,
    channel: funnelContext?.channel,
    device_mid: deviceMid ?? undefined,
    user_id: userId ?? undefined,
    app_version: appVersion ?? undefined,
  });
}

function normalizeCodingPlanEmbeddedReportContext(
  context: CodingPlanEmbeddedReportContext | null | undefined,
): CodingPlanEmbeddedReportContext {
  if (!context) return {};
  return Object.fromEntries(
    Object.entries(context).flatMap(([key, value]) => {
      if (typeof value !== "string") return [];
      const normalized = value.trim();
      return normalized ? [[key, normalized]] : [];
    }),
  ) as CodingPlanEmbeddedReportContext;
}

export function createCodingPlanCredentialClearScript(): string {
  const keys = [...CODING_PLAN_WEBVIEW_CREDENTIAL_LOCAL_STORAGE_KEYS];
  return `(() => {
  for (const key of ${JSON.stringify(keys)}) {
    localStorage.removeItem(key);
  }
  localStorage.removeItem(${JSON.stringify(CODING_PLAN_REPORT_CONTEXT_STORAGE_KEY)});
  delete window.__cfReportContext__;
})()`;
}

export function createCodingPlanScrollbarHideScript(): string {
  return `(() => {
  const styleId = "cf-coding-plan-hide-scrollbar";
  if (document.getElementById(styleId)) return;
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = \`
html,
body,
* {
  scrollbar-width: none !important;
}

html::-webkit-scrollbar,
body::-webkit-scrollbar,
*::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
\`;
  document.head.appendChild(style);
})()`;
}

export function createCodingPlanLangInjectionScript(locale: CodingPlanWebviewLocale): string {
  const resolvedLocale: CodingPlanWebviewLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
  return `(() => {
  window.__cfLang__ = ${JSON.stringify(resolvedLocale)};
  window.dispatchEvent(new CustomEvent("cf-coding-plan-lang-change", {
    detail: ${JSON.stringify({ locale: resolvedLocale })},
  }));
})()`;
}

export function getCodingPlanCredentialKeys(provider: CodingPlanWebsiteProvider): string[] {
  return provider === "zai"
    ? [`oauth:${ZAI_PROVIDER_ID}:access_token`, "cfjwttoken"]
    : [`oauth:${BIGMODEL_PROVIDER_ID}:access_token`, "cfjwttoken"];
}
