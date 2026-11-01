import { contextBridge, ipcRenderer } from "electron";
import {
  CodingPlanWebviewChannels,
  isTrustedCodingPlanWebviewOrigin,
  PlatformChannels,
} from "@origin-ai/cf-shared";

//

const PUBLIC_BRIDGE_KEY = "cfBridge";
const NATIVE_BRIDGE_KEY = "__cfCodingPlanWebviewNativeBridge__";
const LANG_VAR = "__cfLang__";
const LANG_CHANGE_EVENT = "cf-coding-plan-lang-change";
const REPORT_CONTEXT_VAR = "__cfReportContext__";

function isTrustedCodingPlanBridgeLocation(): boolean {
  try {
    const url = new URL(window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (
      !isTrustedCodingPlanWebviewOrigin(url.origin, {
        e2eStoreBridgeEnabled: process.env.VITE_CF_E2E_STORE_BRIDGE === "1",
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

interface NotifyPurchaseCompletePayload {
  provider: "zai" | "bigmodel";
}

type CodingPlanReportContext = Record<string, string>;

interface CodingPlanNativeBridge {
  notifyPurchaseComplete(payload: NotifyPurchaseCompletePayload): void;
  openExternal(url: string): void;
}

if (isTrustedCodingPlanBridgeLocation()) {
  contextBridge.exposeInMainWorld(NATIVE_BRIDGE_KEY, {
    notifyPurchaseComplete(payload: NotifyPurchaseCompletePayload) {
      try {
        ipcRenderer.sendToHost(CodingPlanWebviewChannels.PurchaseComplete, {
          provider: payload.provider,
          timestamp: Date.now(),
        } satisfies import("@origin-ai/cf-shared").CodingPlanPurchaseCompletePayload);
      } catch {
      }
    },
    openExternal(url: string) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
        ipcRenderer.send(PlatformChannels.OpenExternal, {
          sourceUrl: window.location.href,
          url: parsed.toString(),
        });
      } catch {
      }
    },
  } satisfies CodingPlanNativeBridge);

  contextBridge.executeInMainWorld({
    func: (
      publicBridgeKey: string,
      nativeBridgeKey: string,
      langVar: string,
      langChangeEvent: string,
      reportContextVar: string,
    ) => {
      const nativeBridge = (
        window as unknown as Record<string, CodingPlanNativeBridge | undefined>
      )[nativeBridgeKey];
      if (!nativeBridge) return;
      const bridge = {
        notifyPurchaseComplete(payload: NotifyPurchaseCompletePayload) {
          if (payload?.provider !== "zai" && payload?.provider !== "bigmodel") {
            return;
          }
          nativeBridge.notifyPurchaseComplete(payload);
        },
        getLang() {
          const value = (window as unknown as Record<string, unknown>)[langVar];
          return value === "zh-CN" || value === "en-US" ? value : null;
        },
        getReportContext() {
          const value = (window as unknown as Record<string, unknown>)[reportContextVar];
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return null;
          }
          return value as CodingPlanReportContext;
        },
        onLangChange(callback: (locale: "zh-CN" | "en-US") => void) {
          const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ locale?: unknown }>).detail;
            if (detail && (detail.locale === "zh-CN" || detail.locale === "en-US")) {
              callback(detail.locale);
            }
          };
          window.addEventListener(langChangeEvent, handler);
          return () => window.removeEventListener(langChangeEvent, handler);
        },
        openExternal(url: string) {
          nativeBridge.openExternal(url);
        },
      };
      Object.defineProperty(window, publicBridgeKey, {
        value: bridge,
        writable: false,
        configurable: false,
        enumerable: false,
      });
    },
    args: [PUBLIC_BRIDGE_KEY, NATIVE_BRIDGE_KEY, LANG_VAR, LANG_CHANGE_EVENT, REPORT_CONTEXT_VAR],
  });
}
