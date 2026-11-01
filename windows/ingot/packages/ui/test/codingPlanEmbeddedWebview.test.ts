// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_MODEL_PROVIDER_IDS,
  DEFAULT_CF_ENDPOINT_ORIGIN,
  isTrustedCodingPlanWebviewOrigin,
} from "@origin-ai/cf-shared";
import {
  buildCodingPlanEmbeddedWebviewUrl,
  buildCodingPlanEmbeddedReportContext,
  createCodingPlanAuthInjectionScript,
  createCodingPlanCredentialClearScript,
  getCodingPlanCredentialKeys,
  isTrustedCodingPlanEmbeddedWebviewUrl,
  resolveCodingPlanEmbeddedOrigin,
  resolveCodingPlanWebsiteProvider,
} from "@/settings/model-provider-section/codingPlanEmbeddedWebview.js";
import { CodingPlanEmbeddedWebviewDialog } from "@/settings/CodingPlanEmbeddedWebviewDialog.js";

const h = vi.hoisted(() => ({
  theme: "cf-light",
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    activateOrSetWorkspace: vi.fn(),
    connectRemote: vi.fn(),
    getDeviceId: vi.fn(() => Promise.resolve("device-mid-test")),
    notifyRendererReady: vi.fn(),
    onOAuthCallback: vi.fn(),
    openExternal: vi.fn(),
    registerOAuthState: vi.fn(),
    selectDirectory: vi.fn(),
  }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
    locale: "en-US",
  }),
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useCfStoreWithDefault: (
    selector: (state: { theme: string; user: { id: string } | null }) => unknown,
  ) =>
    selector({
      theme: h.theme,
      user: { id: "user-test" },
    }),
}));

afterEach(() => {
  cleanup();
  h.theme = "cf-light";
});

describe("coding plan embedded webview bridge", () => {
  it("builds the website URL with app embedded marker and no telemetry query", () => {
    const url = new URL(
      buildCodingPlanEmbeddedWebviewUrl({
        origin: "https://cf.z.ai",
        provider: "bigmodel",
        audience: "team",
        teamPlanKey: "team-plan-a",
        theme: "cf-light",
      }),
    );

    expect(url.origin).toBe("https://cf.z.ai");
    expect(url.pathname).toBe("/coding-plan");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      provider: "bigmodel",
      embedded: "app",
      lang: "en",
      theme: "cf-light",
      audience: "team",
      teamPlanKey: "team-plan-a",
    });
    expect(url.searchParams.has("purchase_funnel_id")).toBe(false);
    expect(url.searchParams.has("device_mid")).toBe(false);
    expect(url.searchParams.has("user_id")).toBe(false);
    expect(url.searchParams.has("app_version")).toBe(false);
  });

  it.each([
    [BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan, "zai"],
    [BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan, "bigmodel"],
  ] as const)("maps Team Provider %s to website family %s", (providerId, family) => {
    expect(resolveCodingPlanWebsiteProvider(providerId)).toBe(family);
  });

  it("builds the report context that website telemetry reads from the bridge", () => {
    expect(
      buildCodingPlanEmbeddedReportContext({
        deviceMid: "device-mid-test",
        userId: "user-1",
        appVersion: "9.8.7",
        funnelContext: {
          purchaseFunnelId: "funnel-app",
          upgradeSource: "session_quota_alert",
          eventRegion: "app.session",
          eventText: "upgrade",
          entryPlanStatus: "start_plan",
          entryPlanLevel: "start",
          entryPlanList: "start_plan__weekend-plan",
          purchaseAudience: "team",
          providerFamily: "bigmodel",
          channel: "MaaS",
        },
      }),
    ).toMatchObject({
      purchase_funnel_id: "funnel-app",
      purchase_entry_reporter: "app",
      upgrade_source: "session_quota_alert",
      event_region: "app.session",
      event_text: "upgrade",
      entry_plan_status: "start_plan",
      entry_plan_level: "start",
      purchase_audience: "team",
      provider_family: "bigmodel",
      channel: "MaaS",
      device_mid: "device-mid-test",
      user_id: "user-1",
      app_version: "9.8.7",
    });
  });

  it("does not claim app entry reporting without a funnel", () => {
    expect(buildCodingPlanEmbeddedReportContext({})).not.toHaveProperty("purchase_entry_reporter");
  });

  it("preserves entry ownership in window, storage and ready events on reinjection", () => {
    const ready = vi.fn();
    window.addEventListener("cf-coding-plan-auth-ready", ready);
    try {
      const reportContext = {
        purchase_funnel_id: "funnel-app",
        purchase_entry_reporter: "app" as const,
      };
      const script = createCodingPlanAuthInjectionScript({
        provider: "bigmodel",
        credentials: {},
        reportContext,
      });
      window.eval(script);
      window.eval(script);
      expect(
        (window as unknown as { __cfReportContext__: unknown }).__cfReportContext__,
      ).toEqual(reportContext);
      expect(JSON.parse(localStorage.getItem("cf:coding-plan:report-context") || "{}")).toEqual(
        reportContext,
      );
      expect(ready).toHaveBeenCalledTimes(2);
      for (const [event] of ready.mock.calls) {
        expect((event as CustomEvent).detail.reportContext).toEqual(reportContext);
      }
    } finally {
      window.removeEventListener("cf-coding-plan-auth-ready", ready);
      window.eval(createCodingPlanCredentialClearScript());
    }
  });

  it("uses localhost in local development and endpoint origin otherwise", () => {
    expect(
      resolveCodingPlanEmbeddedOrigin({
        dev: true,
        endpointOrigin: "https://cf.z.ai",
        cfEnv: "test",
      }),
    ).toBe("http://localhost:3000");
    expect(
      resolveCodingPlanEmbeddedOrigin({
        dev: true,
        endpointOrigin: "https://cf.z.ai",
        cfEnv: "production",
      }),
    ).toBe("https://cf.z.ai");
    expect(
      resolveCodingPlanEmbeddedOrigin({
        dev: false,
        endpointOrigin: "https://cf.z.ai",
        cfEnv: "production",
      }),
    ).toBe("https://cf.z.ai");
    expect(
      resolveCodingPlanEmbeddedOrigin({
        dev: true,
        endpointOrigin: "https://cf.z.ai",
        cfEnv: "test",
        overrideOrigin: "https://example.test/path",
      }),
    ).toBe("http://localhost:3000");
  });

  it("only trusts official coding plan origins unless the E2E bridge enables loopback mocks", () => {
    expect(isTrustedCodingPlanWebviewOrigin("https://cf.z.ai")).toBe(true);
    expect(isTrustedCodingPlanWebviewOrigin("https://cf.z.ai")).toBe(true);
    expect(isTrustedCodingPlanWebviewOrigin("http://localhost:3000")).toBe(true);
    expect(isTrustedCodingPlanWebviewOrigin("https://evil.example")).toBe(false);
    expect(isTrustedCodingPlanWebviewOrigin("http://127.0.0.1:4555")).toBe(false);
    expect(
      isTrustedCodingPlanWebviewOrigin("http://127.0.0.1:4555", {
        e2eStoreBridgeEnabled: true,
      }),
    ).toBe(true);
  });

  it("trusts PayPal callback pages that return to the embedded Coding Plan page", () => {
    const returnTo = encodeURIComponent(
      "/coding-plan?provider=zai&embedded=app&lang=cn&theme=cf-dark",
    );
    expect(
      isTrustedCodingPlanEmbeddedWebviewUrl(
        `http://localhost:3000/coding-plan/payment/callback?channel=paypal&status=return&returnTo=${returnTo}`,
      ),
    ).toBe(true);
    expect(
      isTrustedCodingPlanEmbeddedWebviewUrl(
        "http://localhost:3000/coding-plan/payment/callback?channel=paypal&status=return",
      ),
    ).toBe(false);
    expect(
      isTrustedCodingPlanEmbeddedWebviewUrl(
        "http://localhost:3000/coding-plan/payment/callback?returnTo=%2Fcoding-plan%3Fprovider%3Dzai",
      ),
    ).toBe(false);
  });

  it("falls back to the official website when a configured webview override is not trusted", () => {
    expect(
      resolveCodingPlanEmbeddedOrigin({
        dev: false,
        endpointOrigin: "https://untrusted.example",
        overrideOrigin: "https://evil.example/path",
      }),
    ).toBe(DEFAULT_CF_ENDPOINT_ORIGIN);
    expect(
      resolveCodingPlanEmbeddedOrigin({
        dev: false,
        endpointOrigin: "https://untrusted.example",
        e2eStoreBridgeEnabled: true,
        overrideOrigin: "http://127.0.0.1:4555/path",
      }),
    ).toBe("http://127.0.0.1:4555");
  });

  it("maps coding plan provider ids to website provider query values", () => {
    expect(
      resolveCodingPlanWebsiteProvider(BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan),
    ).toBe("zai");
    expect(resolveCodingPlanWebsiteProvider(BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan)).toBe("zai");
    expect(
      resolveCodingPlanWebsiteProvider(BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan),
    ).toBe("bigmodel");
  });

  it("injects provider credentials into the webview localStorage and dispatches ready event", () => {
    const script = createCodingPlanAuthInjectionScript({
      provider: "zai",
      theme: "cf-dark",
      locale: "en-US",
      credentials: {
        zaiAccessToken: "zai-business-token",
        cfJwtToken: "cf-jwt",
      },
      reportContext: {
        purchase_funnel_id: "funnel-app",
        device_mid: "device-mid-test",
        user_id: "user-1",
        app_version: "9.8.7",
      },
    });

    expect(script).toContain('localStorage.setItem("oauth:zai:access_token"');
    expect(script).toContain('localStorage.setItem("cfjwttoken"');
    expect(script).toContain("cf-coding-plan-auth-ready");
    expect(script).toContain('"provider":"zai"');
    expect(script).toContain("window.__cfReportContext__");
    expect(script).toContain("cf:coding-plan:report-context");
    expect(script).toContain('"purchase_funnel_id":"funnel-app"');
    expect(script).toContain('"device_mid":"device-mid-test"');
    expect(script).toContain('"user_id":"user-1"');
    expect(script).toContain('"app_version":"9.8.7"');
    expect(script).toContain("reportContext: cfReportContext");
    expect(script).toContain('document.documentElement.classList.toggle("dark"');
    expect(script).toContain('localStorage.setItem("cf-theme", cfTheme)');
    expect(script).toContain('localStorage.removeItem("oauth:bigmodel:access_token")');
  });

  it("injects the cf JWT for the bigmodel provider so the website can query Start Plan balance", () => {
    const script = createCodingPlanAuthInjectionScript({
      provider: "bigmodel",
      theme: "cf-light",
      locale: "zh-CN",
      credentials: {
        bigmodelAccessToken: "bigmodel-business-token",
        cfJwtToken: "cf-jwt",
      },
    });

    expect(script).toContain('localStorage.setItem("oauth:bigmodel:access_token"');
    expect(script).toContain('localStorage.setItem("cfjwttoken"');
    expect(script).toContain('localStorage.removeItem("oauth:zai:access_token")');
  });

  it("loads the cf JWT credential key for both website providers", () => {
    expect(getCodingPlanCredentialKeys("zai")).toEqual(["oauth:zai:access_token", "cfjwttoken"]);
    expect(getCodingPlanCredentialKeys("bigmodel")).toEqual([
      "oauth:bigmodel:access_token",
      "cfjwttoken",
    ]);
  });

  it("clears all provider credential keys from the persistent webview storage", () => {
    const script = createCodingPlanCredentialClearScript();

    expect(script).toContain("oauth:zai:access_token");
    expect(script).toContain("cfjwttoken");
    expect(script).toContain("oauth:bigmodel:access_token");
    expect(script).toContain("localStorage.removeItem(key)");
    expect(script).toContain("cf:coding-plan:report-context");
    expect(script).toContain("delete window.__cfReportContext__");
  });

  it("only injects credentials on the current trusted embedded coding plan page", () => {
    expect(
      isTrustedCodingPlanEmbeddedWebviewUrl(
        "https://cf.z.ai/coding-plan?provider=zai&embedded=app",
      ),
    ).toBe(true);
    expect(
      isTrustedCodingPlanEmbeddedWebviewUrl(
        "https://cf.z.ai/cn/coding-plan?provider=zai&embedded=app",
      ),
    ).toBe(true);
    expect(isTrustedCodingPlanEmbeddedWebviewUrl("https://pay.example/checkout?embedded=app")).toBe(
      false,
    );
    expect(
      isTrustedCodingPlanEmbeddedWebviewUrl("https://cf.z.ai/coding-plan?provider=zai"),
    ).toBe(false);
  });

  it("keeps the initial webview src stable when the app theme changes while open", () => {
    const props = {
      credentialService: { load: vi.fn(() => Promise.resolve(null)) },
      onOpenChange: vi.fn(),
      open: true,
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
    };
    const view = render(createElement(CodingPlanEmbeddedWebviewDialog, props));

    const webview = view.getByTestId("coding-plan-embedded-webview");
    const initialSrc = webview.getAttribute("src");
    expect(initialSrc).toContain("theme=cf-light");

    h.theme = "cf-dark";
    view.rerender(createElement(CodingPlanEmbeddedWebviewDialog, props));

    expect(view.getByTestId("coding-plan-embedded-webview").getAttribute("src")).toBe(initialSrc);
  });
});
