import { BUILTIN_MODEL_PROVIDER_IDS } from "@origin-ai/cf-shared";
import { TID_LOGIN_TRIGGER } from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  DEFAULT_WORKSPACE,
  readModelProvider,
  seedCredentials,
  seedSettings,
  waitForWorkspaceApp,
} from "#e2e/helpers/desktop-app";
import {
  openBigModelCodingPlanPersonalUpgradePanel,
  openZaiCodingPlanPersonalUpgradePanel,
} from "#e2e/helpers/coding-plan-upgrade";
import {
  readCodingPlanWebviewLocalStorage,
  readCodingPlanUpgradeMockRequests,
  triggerCodingPlanWebviewPurchaseComplete,
  waitForCodingPlanUpgradeMockRequest,
  waitForCodingPlanWebviewClosed,
  waitForCodingPlanWebviewDisplayed,
} from "#e2e/helpers/coding-plan-upgrade-webview";

describe("BigModel Coding Plan official website webview payment completion E2E", () => {
  afterEach(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("CPUW-01: webview notifies App to close upgrade popup and refresh current provider", async function () {
    this.timeout(120000);

    const setInventoryMode = async (mode: "hold" | "fail" | "ready") => {
      const base =
        process.env.CF_CODING_PLAN_UPGRADE_MOCK_BASE_URL ??
        process.env.BIGMODEL_TEST_API_BASE_URL;
      if (!base) throw new Error("Missing mock URL");
      const response = await fetch(`${base}/__e2e/coding-plan/inventory-mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      expect(response.ok).toBe(true);
    };
    await setInventoryMode("hold");
    await browser.refresh();
    const telemetryFetch = await browser.electron.mock("net", "fetch");
    await telemetryFetch.mockResolvedValue({ ok: true, status: 204 });
    await openBigModelCodingPlanPersonalUpgradePanel(async () => {
      const entry = () => $('[data-testid="sidebar-coding-plan-upgrade-button"]');
      await browser.waitUntil(async () => (await entry().getAttribute("data-disabled")) !== null, {
        timeout: 10000,
      });
      expect(await entry().getText()).toMatch(/Loading plans|In progressQuery套餐/);
      expect(await $('[data-testid="coding-plan-embedded-webview"]').isExisting()).toBe(false);
      await setInventoryMode("fail");
      await browser.waitUntil(
        async () => {
          if (!(await entry().isExisting()))
            await $(`[data-testid="${TID_LOGIN_TRIGGER}"]`).click();
          return /Retry|Retry/.test(await entry().getText());
        },
        {
          timeout: 15000,
        },
      );
      await telemetryFetch.update();
      expect(
        telemetryFetch.mock.calls.filter(([, init]) =>
          String((init as { body?: string })?.body).includes("coding_plan_upgrade_ck"),
        ),
      ).toHaveLength(0);
      await setInventoryMode("ready");
      await entry().click();
      expect(await $('[data-testid="coding-plan-embedded-webview"]').isExisting()).toBe(false);
      await browser.waitUntil(
        async () => {
          if (!(await entry().isExisting()))
            await $(`[data-testid="${TID_LOGIN_TRIGGER}"]`).click();
          const label = await entry().getText();
          return !/Retry|Retry|Loading plans|In progressQuery套餐/.test(label);
        },
        { timeout: 15000 },
      );
      await telemetryFetch.update();
      expect(
        telemetryFetch.mock.calls.filter(([, init]) =>
          String((init as { body?: string })?.body).includes("coding_plan_upgrade_ck"),
        ),
      ).toHaveLength(0);
    });
    await waitForCodingPlanWebviewDisplayed();

    const readEntryEvents = async () => {
      await telemetryFetch.update();
      return telemetryFetch.mock.calls.flatMap(([url, init]) => {
        if (!String(url).includes("/event/report")) return [];
        const body = (init as { body?: string } | undefined)?.body;
        if (!body) return [];
        const event = JSON.parse(body) as {
          element_name: string;
          event_extra_detail: Record<string, string>;
        };
        return event.element_name === "coding_plan_upgrade_ck" ? [event] : [];
      });
    };
    await browser.waitUntil(async () => (await readEntryEvents()).length === 1, {
      timeout: 10000,
      timeoutMsg: "购买入口没有通过 App net.fetch 上报一次",
    });
    const [entry] = await readEntryEvents();
    if (!entry) throw new Error("App 入口事件不存在");
    expect(entry.event_extra_detail.purchase_funnel_id).toBeTruthy();
    expect(entry.event_extra_detail.entry_plan_list).toBe(
      "coding_plan__personal_pro,start_plan__cf_v3_start_plan",
    );
    await browser.waitUntil(
      async () => {
        const storage = await readCodingPlanWebviewLocalStorage([
          "cf:coding-plan:report-context",
        ]);
        const context = JSON.parse(storage["cf:coding-plan:report-context"] || "{}");
        return (
          context.purchase_funnel_id === entry.event_extra_detail.purchase_funnel_id &&
          context.purchase_entry_reporter === "app" &&
          (context.entry_plan_list ?? "") === entry.event_extra_detail.entry_plan_list
        );
      },
      { timeout: 10000, timeoutMsg: "App reported fields are inconsistent with WebView injected context" },
    );
    await browser.electron.execute((electron) => {
      const guest = electron.webContents
        .getAllWebContents()
        .find(
          (contents) =>
            contents.getType() === "webview" && contents.getURL().includes("coding-plan"),
        );
      if (!guest) throw new Error("购买 WebView 不存在");
      return new Promise<void>((resolve) => {
        guest.once("did-finish-load", () => resolve());
        guest.reload();
      });
    });
    await browser.waitUntil(
      async () => {
        const storage = await readCodingPlanWebviewLocalStorage([
          "cf:coding-plan:report-context",
        ]);
        const context = JSON.parse(storage["cf:coding-plan:report-context"] || "{}");
        return (
          context.purchase_entry_reporter === "app" &&
          context.purchase_funnel_id === entry.event_extra_detail.purchase_funnel_id
        );
      },
      { timeout: 10000 },
    );
    expect(await readEntryEvents()).toHaveLength(1);
    await waitForCodingPlanUpgradeMockRequest(
      (request) =>
        request.method === "POST" &&
        request.path ===
          "/api/biz/v1/organization/org-e2e/projects/proj-e2e/api_keys/bigmodel-personal-api-key/access_tokens" &&
        request.headers.authorization === "Bearer e2e-bigmodel-oauth-token",
      "Account initialization did not issue BigModel PAT",
    );
    await completePurchaseAndWaitForRefresh("bigmodel");
    expect(
      (await readCodingPlanUpgradeMockRequests()).requests.some((request) =>
        request.path.includes("/copy/"),
      ),
    ).toBe(false);
    expect(
      (await readModelProvider(BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan))?.apiKey ??
        "",
    ).toBe("");
  });

  it("CPUW-03: Z.ai webview notifies App to close upgrade popup and refresh current provider and Team Plan products", async function () {
    this.timeout(120000);

    await prepareZaiCodingPlanUpgradeState();
    await openZaiCodingPlanPersonalUpgradePanel();
    await waitForCodingPlanWebviewDisplayed();

    await waitForZaiWebviewCredentialsInjected();

    await completePurchaseAndWaitForRefresh("zai");
    expect(
      (await readModelProvider(BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan))?.apiKey ?? "",
    ).toBe("");
  });
});

async function completePurchaseAndWaitForRefresh(provider: "bigmodel" | "zai") {
  const before = (await readCodingPlanUpgradeMockRequests()).requests;
  const subscriptionAuthorization = before.findLast(
    (request) => request.path === "/api/biz/subscription/list",
  )?.headers.authorization;
  expect(Boolean(subscriptionAuthorization)).toBe(true);
  await triggerCodingPlanWebviewPurchaseComplete(provider);
  await waitForCodingPlanWebviewClosed();
  const expectedToken =
    provider === "bigmodel" ? "e2e-bigmodel-oauth-token" : "zai-webview-oauth-token";
  await browser.waitUntil(
    async () => {
      const requests = (await readCodingPlanUpgradeMockRequests()).requests.slice(before.length);
      return ["/api/biz/subscription/list", "/api/biz/subscription/enterprise/v2/pricing"].every(
        (path) =>
          requests.some(
            (request) =>
              request.path === path &&
              request.headers.authorization ===
                (path.endsWith("/subscription/list") ? subscriptionAuthorization : expectedToken),
          ),
      );
    },
    { timeout: 30000, timeoutMsg: `${provider} BuyCompleted后未按Current账NumberRefresh订阅与企业套餐` },
  );
}

async function prepareZaiCodingPlanUpgradeState() {
  await clearAppData();
  await seedCredentials("zai-webview-oauth-token");
  await seedSettings({
    providerFamilyConnectionSelections: {
      zai: { kind: "individual-coding-plan" },
      bigmodel: { kind: "individual-coding-plan" },
    },
    providerFamilyDomain: "zai",
    providerFamilyDomainMigrated: true,
    lastWorkspaceSession: [
      {
        kind: "local",
        workspacePath: DEFAULT_WORKSPACE,
        workspacePurpose: "project",
      },
    ],
    lastActiveTabIndex: 0,
  });
  await browser.reloadSession();
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60000);
}

async function waitForZaiWebviewCredentialsInjected() {
  let latestStorage: Record<string, string | null> = {};
  await browser.waitUntil(
    async () => {
      latestStorage = await readCodingPlanWebviewLocalStorage([
        "oauth:zai:access_token",
        "cfjwttoken",
        "oauth:bigmodel:access_token",
      ]);
      return (
        latestStorage["oauth:zai:access_token"] === "zai-webview-oauth-token" &&
        latestStorage.cfjwttoken === "zai-webview-oauth-token" &&
        latestStorage["oauth:bigmodel:access_token"] === null
      );
    },
    {
      timeout: 30000,
      timeoutMsg: `Z.ai credentials 没有注入到 Coding Plan webview localStorage: ${JSON.stringify(latestStorage)}`,
    },
  );
}
