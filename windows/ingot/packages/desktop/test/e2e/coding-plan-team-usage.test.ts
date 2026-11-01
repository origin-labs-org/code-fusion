import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_MODEL_PROVIDER_IDS, type ProviderFamilyConnectionSelection } from "@origin-ai/cf-shared";
import {
  TID_MODEL_PROVIDER_CONNECTION_MODE_ITEM,
  TID_MODEL_PROVIDER_CONNECTION_MODE_TRIGGER,
  TID_MODEL_PROVIDER_NAV_ITEM,
  TID_LOGIN_TRIGGER,
  TID_CHAT_CONTEXT_USAGE_TRIGGER,
  TID_SETTINGS_USAGE_TAB,
  TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_V4_MODEL_CONFIG,
  TID_V4_COMPOSER_INPUT,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  getE2EAppDataPaths,
  quitElectronAppGracefully,
  readModelProviders,
  waitForDefaultWorkspaceReady,
  waitForWorkspaceApp,
} from "./helpers/desktop-app.js";
import { waitForProviderConfigPolling } from "./helpers/provider-config-polling.js";
import { selectRegistryProviderModelById, UPSTREAM_MODEL } from "./helpers/upstream-provider.js";
import { seedPersistedModelSelection } from "./helpers/model-provider-restart.js";
import { sel } from "./helpers/selectors.js";
import { skipOccupationOnboardingIfPresent } from "./helpers/occupation-onboarding.js";

const E2E_APP_DATA_PATHS = getE2EAppDataPaths();
const E2E_STORAGE_ROOT = E2E_APP_DATA_PATHS.storageRoot;
const SETTINGS_FILE = join(E2E_APP_DATA_PATHS.appDataDir, "setting.json");
const CREDENTIALS_FILE = E2E_APP_DATA_PATHS.credentialsFile;
const TEAM_PLAN_KEY = "team:bigmodel:product-team-a:org-team-a:proj-team-a";
const PERSONAL_PLAN_KEY = "account:bigmodel-individual-coding-plan";
const PERSONAL_PLAN_CONNECTION_KEY = `coding-plan:${PERSONAL_PLAN_KEY}`;
const BIGMODEL_ACCOUNT_NAV_KEY = `preset:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan}`;
const BIGMODEL_E2E_MODEL = "GLM-5.3";

type CodingPlanScenario = "personalOnly" | "teamOnly" | "both";
type CodingPlanFaultMode =
  | "none"
  | "optionalActivity"
  | "quotaBusinessFailure"
  | "quotaFailure"
  | "startBalance"
  | "startBalanceFailure"
  | "unavailableTeam"
  | "expiredTeam"
  | "twoTeams";
type CodingPlanResetScenario =
  | "none"
  | "emptyThenGrant"
  | "existingMultiple"
  | "fiveHourUse"
  | "multiFiveHourUse"
  | "multiFiveHourUseLagging"
  | "urgentOpportunity";

describe("Team Plan Settings and Usage Statistics E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("CTP-13: Start balance rate limit shows retry; displays plan once recovered", async function () {
    this.timeout(120000);
    const evidenceDir =
      process.env.CF_E2E_ARTIFACT_DIR || join(process.cwd(), ".e2e-artifacts", "coding-plan");
    await mkdir(evidenceDir, { recursive: true });
    await prepareScenario(
      "personalOnly",
      BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
      "startBalanceFailure",
    );
    await openModelProviderSettings();
    await clickVisibleTestIdByDom(
      testId(
        TID_MODEL_PROVIDER_NAV_ITEM,
        `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan}`,
      ),
      {
        timeout: 10000,
        timeoutMsg: "Missing BigModel entry",
      },
    );
    await assertBodyTextIncludesAny(["重试", "Retry"]);
    await assertBodyTextIncludesAny(["Fetch failed", "获取失败"]);
    await browser.saveScreenshot(join(evidenceDir, "coding-plan-start-failure.png"));
    await assertBodyTextExcludes([
      "Could not verify Coding Plan entitlement. Connect again and retry.",
      "Unable to verify Coding Plan benefits right now. Please reconnect and try again.",
    ]);
    await setMockScenario("personalOnly", "startBalance");
    await browser.pause(1000);
    await clickVisibleButtonByText(["重试", "Retry"]);
    await assertBodyTextIncludes(["GLM-5-Turbo"]);
    await browser.waitUntil(
      async () =>
        !(await browser.execute(() => document.body.innerText)).match(/Fetch failed|Failed to fetch/),
      { timeout: 15000, timeoutMsg: "Failure state not recovered after retry" },
    );
    await browser.saveScreenshot(join(evidenceDir, "coding-plan-start-recovered.png"));
  });

  it("CTP-01: Team Plan pricing should be fetched after login even without entering settings", async function () {
    this.timeout(90000);

    await prepareScenario("both", TEAM_PLAN_KEY);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60000);

    await waitForMockRequest(
      (request) => request.path.endsWith("/subscription/enterprise/v2/pricing"),
      "Enterprise plan pricing was not requested without entering settings",
    );
    await expect($(sel(TID_SETTINGS_PAGE))).not.toBeDisplayed();
  });

  it("CTP-02: Settings connection methods should display personal Coding Plan and Team Plan", async function () {
    this.timeout(120000);

    await prepareScenario("both", PERSONAL_PLAN_KEY);
    await openModelProviderSettings();
    await clickVisibleTestIdByDom(testId(TID_MODEL_PROVIDER_NAV_ITEM, BIGMODEL_ACCOUNT_NAV_KEY), {
      timeout: 30000,
      timeoutMsg: "BigModel provider navigation item did not appear",
    });
    await assertConnectionModeOptionsInclude([
      {
        key: PERSONAL_PLAN_CONNECTION_KEY,
        labels: ["Individual Plan", "个人套餐"],
      },
      { key: TEAM_PLAN_KEY, labels: ["Team Org"] },
    ]);

    await selectConnectionModeOptionByTestId(
      testId(TID_MODEL_PROVIDER_CONNECTION_MODE_ITEM, TEAM_PLAN_KEY),
      "Team Org",
    );
    await browser.waitUntil(
      async () => {
        const settings = await readSettings();
        const selection = settings.providerFamilyConnectionSelections?.bigmodel;
        return (
          selection?.kind === "team-coding-plan" &&
          selection.productId === "product-team-a" &&
          selection.organizationId === "org-team-a" &&
          selection.projectId === "proj-team-a"
        );
      },
      {
        timeout: 15000,
        timeoutMsg: "Structured BigModel connection selection not written after selecting Team Plan",
      },
    );
  });

  for (const empty of [false, true]) {
    it(`CTP-${empty ? 26 : 25}: 未登录${empty ? "Open settings directly with no Provider" : "API 正常选择且无团队登录错误"}`, async function () {
      this.timeout(240000);
      await prepareScenario("both", PERSONAL_PLAN_KEY, "none", "none", "en-US", true);
      for (const width of [1100, 390]) {
        for (const theme of ["cf-light", "cf-dark"] as const) {
          const disabledProviders = await browser.execute(async (remove) => {
            const element = document.querySelector('[data-testid="v4-model-config"]')!;
            let fiber = (element as any)[
              Object.keys(element).find((key) => key.startsWith("__reactFiber"))!
            ];
            let service: any;
            while (fiber && !service) {
              service =
                fiber.memoizedProps?.value?.providerSettingsService ??
                fiber.memoizedProps?.services?.providerSettingsService;
              fiber = fiber.return;
            }
            if (!service) throw new Error("ProviderSettingsService not found");
            const disabledProviders: { providerId: string; config: Record<string, unknown> }[] = [];
            if (remove) {
              const view = await service.getView();
              for (const provider of view.providers) {
                if (provider.effectiveConfig.access?.type !== "zhipu-account" && provider.enabled) {
                  await service.savePersonalProviderOverlay(
                    provider.providerId,
                    provider.personalConfig ?? {},
                    { enabled: false },
                  );
                  disabledProviders.push({
                    providerId: provider.providerId,
                    config: provider.personalConfig ?? {},
                  });
                }
              }
            }
            await service.refresh("e2e-logged-out-composer");
            return disabledProviders;
          }, empty);
          await setRendererViewport(width, 850);
          await setSettingsTheme(theme);
          if (empty) {
            await clickVisibleTestIdByDom(TID_CHAT_MODEL_SELECT_TRIGGER, { timeout: 15000 });
            await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
            expect(
              await browser.execute(
                () => document.querySelector("[data-composer-model-list]") === null,
              ),
            ).toBe(true);
            await clickVisibleTestIdByDom(TID_SETTINGS_BACK_BUTTON, { timeout: 15000 });
            await browser.execute(async (providers) => {
              const element = document.querySelector('[data-testid="v4-model-config"]')!;
              let fiber = (element as any)[
                Object.keys(element).find((key) => key.startsWith("__reactFiber"))!
              ];
              let service: any;
              while (fiber && !service) {
                service =
                  fiber.memoizedProps?.value?.providerSettingsService ??
                  fiber.memoizedProps?.services?.providerSettingsService;
                fiber = fiber.return;
              }
              if (!service) throw new Error("ProviderSettingsService not found");
              for (const provider of providers)
                await service.savePersonalProviderOverlay(provider.providerId, provider.config, {
                  enabled: true,
                });
            }, disabledProviders);
          } else {
            await selectRegistryProviderModelById(UPSTREAM_MODEL, {
              providerId: process.env.E2E_PROVIDER_ID,
            });
            await clickVisibleTestIdByDom(TID_CHAT_MODEL_SELECT_TRIGGER, { timeout: 15000 });
            expect(
              await browser.execute(
                () =>
                  document.querySelector("[data-composer-model-list]")?.textContent?.length ?? 0,
              ),
            ).toBeGreaterThan(0);
            expect(
              await browser.execute(() =>
                document.body.textContent?.includes("coding_plan_oauth_required"),
              ),
            ).toBe(false);
            await browser.keys("Escape");
          }
        }
      }
      await clearRendererViewport();
    });
  }

  it("CTP-30: Personal/team switch list has no horizontal overflow and preserves vertical scrolling", async function () {
    this.timeout(240000);
    try {
      for (const width of [1100, 390])
        for (const theme of ["cf-light", "cf-dark"] as const) {
          await prepareScenario("both", PERSONAL_PLAN_KEY);
          await setRendererViewport(width, 850);
          await setSettingsTheme(theme);
          await clickVisibleTestIdByDom(TID_CHAT_MODEL_SELECT_TRIGGER, { timeout: 15000 });
          await browser.execute(() => {
            const samples: { client: number; scroll: number }[] = [];
            const record = () => {
              for (const list of document.querySelectorAll<HTMLElement>(
                "[data-composer-provider-list]",
              ))
                if (list.getBoundingClientRect().width > 0)
                  samples.push({ client: list.clientWidth, scroll: list.scrollWidth });
            };
            const observer = new MutationObserver(record);
            observer.observe(document.body, { subtree: true, childList: true, attributes: true });
            Object.assign(window, {
              __providerWidthProbe: { samples, stop: () => observer.disconnect() },
            });
          });
          for (const [label, providerId] of [
            ["BigModel Team Org", BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan],
            ["BigModel Individual", BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan],
          ]) {
            await $('[data-testid="composer-provider-trigger"]').waitForClickable({
              timeout: 15000,
            });
            await $('[data-testid="composer-provider-trigger"]').click();
            const row = $('[aria-label="' + label + '"]');
            await row.waitForDisplayed({ timeout: 15000 });
            const geometry = await browser.execute(() => {
              const list = document.querySelector<HTMLElement>("[data-composer-provider-list]")!;
              const before = { client: list.clientWidth, scroll: list.scrollWidth };
              const style = list.getAttribute("style");
              const rows = list.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
              if (rows.length < 2) throw new Error("滚动夹具至少需要两个 Provider");
              list.style.maxHeight = `${rows[0]!.getBoundingClientRect().height}px`;
              const vertical = list.scrollHeight > list.clientHeight;
              list.scrollTop = 10;
              const scrolled = list.scrollTop > 0;
              list.scrollTop = 0;
              if (style === null) list.removeAttribute("style");
              else list.setAttribute("style", style);
              return { ...before, vertical, scrolled };
            });
            expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
            expect(geometry.vertical && geometry.scrolled).toBe(true);
            await row.click();
            await browser.waitUntil(
              async () =>
                (await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-provider")) === providerId,
              { timeout: 15000 },
            );
          }
          const samples = await browser.execute(() => {
            const probe = (window as any).__providerWidthProbe;
            probe.stop();
            return probe.samples as { client: number; scroll: number }[];
          });
          await writeFile(
            join(process.env.CF_E2E_ARTIFACT_DIR!, `provider-width-${width}-${theme}.json`),
            JSON.stringify(samples, null, 2),
          );
          expect(samples.length).toBeGreaterThan(0);
          expect(samples.every((sample) => sample.scroll <= sample.client)).toBe(true);
          await browser.keys("Escape");
        }
    } finally {
      await browser.execute(() => (window as any).__providerWidthProbe?.stop());
      await clearRendererViewport();
    }
  });

  it("CTP-27: Logging out after team loaded does not retain old organization directory", async function () {
    this.timeout(240000);
    try {
      for (const width of [1100, 390])
        for (const theme of ["cf-light", "cf-dark"] as const) {
          await prepareScenario("both", PERSONAL_PLAN_KEY);
          await setRendererViewport(width, 850);
          await setSettingsTheme(theme);
          await selectRegistryProviderModelById(UPSTREAM_MODEL, {
            providerId: process.env.E2E_PROVIDER_ID,
          });
          await clickVisibleTestIdByDom(TID_CHAT_MODEL_SELECT_TRIGGER, { timeout: 15000 });
          await $('[data-testid="composer-provider-trigger"]').click();
          await $('[aria-label="BigModel Team Org"]').waitForClickable({ timeout: 15000 });
          await $('[aria-label="BigModel Team Org"]').click();
          await browser.waitUntil(
            async () =>
              (await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-provider")) ===
              BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
            { timeout: 15000 },
          );
          await browser.keys("Escape");
          const usageTrigger = await $(sel(TID_CHAT_CONTEXT_USAGE_TRIGGER));
          await usageTrigger.waitForDisplayed({ timeout: 15000 });
          await usageTrigger.moveTo();
          await browser.waitUntil(
            async () =>
              (await readComposerTeamUsageSource())?.startsWith("team:bigmodel:") === true,
            { timeout: 15000, timeoutMsg: "团队用量来源未加载" },
          );
          await browser.keys("Escape");
          await clickVisibleTestIdByDom(TID_CHAT_MODEL_SELECT_TRIGGER, { timeout: 15000 });
          await $('[data-testid="composer-provider-trigger"]').click();
          await $('[aria-label="BigModel Team Org"]').waitForDisplayed({ timeout: 15000 });
          await installConnectionBoundaryProbe("logout");
          await browser.waitUntil(
            async () => !(await $('[aria-label="BigModel Team Org"]').isExisting()),
            { timeout: 15000, timeoutMsg: "Previous account organization still displayed after logout" },
          );
          await browser.keys("Escape");
          await browser.waitUntil(async () => (await readComposerTeamUsageSource()) === null, {
            timeout: 5000,
            timeoutMsg: "Old team usage still visible before Provider refresh",
          });
          await browser.execute(async () => {
            await (window as any).__logoutBoundaryRelease();
          });
          await selectRegistryProviderModelById(UPSTREAM_MODEL, {
            providerId: process.env.E2E_PROVIDER_ID,
          });
          await browser.saveScreenshot(
            join(process.env.CF_E2E_ARTIFACT_DIR!, "logout-" + width + "-" + theme + ".png"),
          );
        }
    } finally {
      const diagnostic = await browser.execute(() => (window as any).__logoutBoundaryAuth?.());
      await writeFile(
        join(process.env.CF_E2E_ARTIFACT_DIR!, "logout-boundary.json"),
        JSON.stringify({ auth: diagnostic, source: await readComposerTeamUsageSource() }),
      );
      await browser.execute(async () => {
        await (window as any).__logoutBoundaryRelease?.();
      });
      await clearRendererViewport();
    }
  });

  for (const mode of ["cas", "mismatch", "refresh-failure"] as const) {
    it(
      "CTP-" +
        (mode === "cas" ? "28" : mode === "mismatch" ? "29" : "31") +
        ": " +
        mode +
        " Conflict releases lock and allows retry",
      async function () {
        this.timeout(120000);
        await prepareScenario(
          "both",
          mode === "refresh-failure" ? TEAM_PLAN_KEY : PERSONAL_PLAN_KEY,
          mode === "refresh-failure" ? "twoTeams" : "none",
        );
        const targetRow =
          mode === "refresh-failure"
            ? '[aria-label="BigModel Active Team"]'
            : '[aria-label="BigModel Team Org"]';
        await clickVisibleTestIdByDom(TID_CHAT_MODEL_SELECT_TRIGGER, { timeout: 15000 });
        await $('[data-testid="composer-provider-trigger"]').click();
        await $(targetRow).waitForClickable({ timeout: 15000 });
        await installConnectionBoundaryProbe(mode);
        try {
          await browser.keys("Escape");
          await browser.keys("Escape");
          await $(sel(TID_V4_COMPOSER_INPUT)).click();
          await browser.keys("E2E_CONNECTION_BOUNDARY");
          if (mode === "refresh-failure") {
            await clickVisibleTestIdByDom(TID_CHAT_MODEL_SELECT_TRIGGER, { timeout: 15000 });
            await $('[data-testid="composer-provider-trigger"]').click();
            await $('[aria-label="BigModel Team Org"]').waitForClickable({ timeout: 15000 });
            await $('[aria-label="BigModel Team Org"]').click();
            await browser.waitUntil(
              async () =>
                (await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-provider")) ===
                BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
              { timeout: 15000, timeoutMsg: "起点未进入团队 Provider" },
            );
            await browser.waitUntil(
              async () =>
                (await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-thought-levels"))
                  ?.split(",")
                  .includes("max") === true,
              { timeout: 15000, timeoutMsg: "Starting team model capabilities not yet hydrated" },
            );
            await browser.keys("Escape");
            await browser.keys("Escape");
          }
          await clickVisibleTestIdByDom(TID_CHAT_MODEL_SELECT_TRIGGER, { timeout: 15000 });
          await $('[data-testid="composer-provider-trigger"]').waitForClickable({ timeout: 15000 });
          await $('[data-testid="composer-provider-trigger"]').click();
          await $(targetRow).waitForClickable({ timeout: 15000 });
          await browser.execute(() => (window as any).__connectionBoundaryProbe.arm());
          await $(targetRow).click();
          if (mode === "mismatch") {
            await browser.waitUntil(
              async () =>
                (await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-provider")) ===
                "e2e-upstream",
              { timeout: 15000, timeoutMsg: "展示 owner 未投影冲突选择" },
            );
            await browser.keys("Escape");
            await browser.keys("Escape");
            await clickVisibleTestIdByDom(TID_CHAT_MODEL_SELECT_TRIGGER, { timeout: 15000 });
          }
          await $('[role="alert"]').waitForDisplayed({ timeout: 15000 });
          expect(await $('[data-testid="composer-provider-loading"]').isExisting()).toBe(false);
          const trace = await browser.execute(
            () => (window as any).__connectionBoundaryProbe.trace,
          );
          expect(trace.length).toBeGreaterThan(0);
          await writeFile(
            join(process.env.CF_E2E_ARTIFACT_DIR!, "connection-" + mode + ".json"),
            JSON.stringify(trace, null, 2),
          );
          if (mode === "cas")
            expect((await readSettings()).providerFamilyConnectionSelections?.zai).toEqual({
              kind: "individual-coding-plan",
            });
        } finally {
          const diagnostics = await browser.execute(() => {
            const probe = (window as any).__connectionBoundaryProbe;
            const element = document.querySelector(
              '[data-testid="v4-model-config"]',
            ) as HTMLElement;
            return {
              trace: probe.trace,
              config: element?.dataset,
              alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(
                (e) => e.textContent,
              ),
            };
          });
          await writeFile(
            join(process.env.CF_E2E_ARTIFACT_DIR!, "boundary-" + mode + ".json"),
            JSON.stringify(diagnostics, null, 2),
          );
          await browser.execute((mode) => {
            const probe = (window as any).__connectionBoundaryProbe;
            if (mode === "refresh-failure") probe.recover();
            else probe.restore();
          }, mode);
        }
        await browser.keys("Escape");
        await browser.keys("Escape");
        if (mode !== "refresh-failure") {
          await $(sel(TID_V4_COMPOSER_INPUT)).click();
          await browser.keys("E2E_CONNECTION_RETRY");
        }
        await clickVisibleTestIdByDom(TID_CHAT_MODEL_SELECT_TRIGGER, { timeout: 15000 });
        const trigger = $('[data-testid="composer-provider-trigger"]');
        await trigger.waitForClickable({ timeout: 15000 });
        await trigger.click();
        await $(targetRow).waitForClickable({ timeout: 15000 });
        await $(targetRow).click();
        await browser.waitUntil(
          async () =>
            (await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-provider")) ===
            BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
          { timeout: 15000 },
        );
        if (mode === "refresh-failure") {
          await browser.waitUntil(
            async () =>
              browser.execute(() =>
                (window as any).__connectionBoundaryProbe.trace.some(
                  (entry: any) => entry.phase === "obsolete-started",
                ),
              ),
            { timeout: 15000 },
          );
          await browser.execute(() => (window as any).__connectionBoundaryProbe.supersede());
          await browser.waitUntil(
            async () =>
              browser.execute(() =>
                (window as any).__connectionBoundaryProbe.trace.some(
                  (entry: any) => entry.phase === "presentation-recovered",
                ),
              ),
            { timeout: 15000 },
          );
          await browser.execute(() => (window as any).__connectionBoundaryProbe.rejectObsolete());
        }
        if (mode === "refresh-failure")
          await browser.waitUntil(
            async () =>
              browser.execute(() =>
                (window as any).__connectionBoundaryProbe.trace.some(
                  (entry: any) => entry.phase === "presentation-recovered",
                ),
              ),
            { timeout: 15000, timeoutMsg: "Same connection retry did not request display re-read" },
          );
        await browser.waitUntil(
          async () => !(await $('[data-testid="composer-provider-loading"]').isExisting()),
          { timeout: 15000 },
        );
        expect(await $('[role="alert"]').isExisting()).toBe(false);
        await browser.keys("Escape");
        if (mode === "refresh-failure") {
          const trace = await browser.execute(
            () => (window as any).__connectionBoundaryProbe.trace,
          );
          const recoveredAt = trace.findIndex((entry: any) => entry.phase === "fault-recovered");
          expect(
            trace.slice(recoveredAt + 1).some((entry: any) => entry.phase === "target-event"),
          ).toBe(false);
          const synchronized = trace.findLast(
            (entry: any) => entry.phase === "target-synchronized",
          );
          expect(synchronized).toBeDefined();
          expect(
            trace.some(
              (entry: any) =>
                entry.phase === "presentation-recovered" &&
                entry.revision === synchronized.revision,
            ),
          ).toBe(true);
          await writeFile(
            join(process.env.CF_E2E_ARTIFACT_DIR!, "connection-retry-no-event.json"),
            JSON.stringify(trace, null, 2),
          );
          await browser.execute(() => (window as any).__connectionBoundaryProbe.restore());
        }
      },
    );
  }

  it("CTP-24: Composer only hides expired teams; other valid teams can be switched", async function () {
    this.timeout(240000);
    try {
      for (const width of [1100, 390]) {
        for (const theme of ["cf-light", "cf-dark"] as const) {
          await prepareScenario("both", TEAM_PLAN_KEY, "expiredTeam", "none", "en-US");
          const states = await browser.execute(async () => {
            const element = document.querySelector('[data-testid="v4-model-config"]')!;
            let fiber = (element as any)[
              Object.keys(element).find((key) => key.startsWith("__reactFiber"))!
            ];
            let service: any;
            while (fiber && !service) {
              service =
                fiber.memoizedProps?.value?.providerSettingsService ??
                fiber.memoizedProps?.services?.providerSettingsService;
              fiber = fiber.return;
            }
            if (!service) throw new Error("ProviderSettingsService not found");
            const view = await service.refresh("e2e-expired-team");
            return view.providers.map((provider: any) => ({
              id: provider.providerId,
              state: provider.accountState?.availability,
            }));
          });
          expect(
            states.find(
              (provider: { id: string; state?: string }) =>
                provider.id === BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
            )?.state,
          ).toBe("unavailable");
          await setRendererViewport(width, 850);
          await setSettingsTheme(theme);
          const trigger = $(sel(TID_CHAT_MODEL_SELECT_TRIGGER));
          await trigger.waitForClickable({ timeout: 30000 });
          await trigger.click();
          const connection = $('[data-testid="composer-provider-trigger"]');
          await connection.waitForDisplayed({ timeout: 15000 });
          await connection.click();
          await $("[data-composer-provider-list]").waitForDisplayed({ timeout: 10000 });
          expect(await $('[aria-label="BigModel Team Org"]').isExisting()).toBe(false);
          const activeTeam = $('[aria-label="BigModel Active Team"]');
          await activeTeam.waitForClickable({ timeout: 15000 }).catch(async (cause) => {
            const menu = await browser.execute(() => {
              const element = document.querySelector('[data-testid="v4-model-config"]')!;
              let fiber = (element as any)[
                Object.keys(element).find((key) => key.startsWith("__reactFiber"))!
              ];
              while (fiber && !fiber.memoizedProps?.composerOptions) fiber = fiber.return;
              return {
                text: document.querySelector("[data-composer-provider-list]")?.textContent,
                groups: fiber?.memoizedProps?.composerOptions?.providerMenu?.groups?.map(
                  (g: any) => ({ key: g.key, badge: g.labelBadge }),
                ),
              };
            });
            throw new Error(`有效Team缺失：${JSON.stringify(menu)}`, { cause });
          });
          await activeTeam.click();
          await browser.waitUntil(
            async () => {
              const selection = (await readSettings()).providerFamilyConnectionSelections?.bigmodel;
              return (
                selection?.kind === "team-coding-plan" &&
                selection.organizationId === "org-team-b" &&
                selection.projectId === "proj-team-b"
              );
            },
            { timeout: 15000, timeoutMsg: "Full identity of valid team not written" },
          );
          await browser.waitUntil(
            async () =>
              (await connection.getText()).includes("Active Team") &&
              (await connection.getAttribute("aria-busy")) !== "true",
            { timeout: 30000, timeoutMsg: "Valid team switch not completed" },
          );
          await browser.keys("Escape");
          await browser.keys("Escape");
        }
      }
    } finally {
      await clearRendererViewport();
    }
  });

  it("CTP-20: Composer provider list displays teams directly; switching updates actual identity", async function () {
    this.timeout(120000);
    await prepareScenario("both", PERSONAL_PLAN_KEY, "unavailableTeam");
    await selectRegistryProviderModelById(BIGMODEL_E2E_MODEL, {
      includePlainModelFallback: false,
      providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    });
    const trigger = $(sel(TID_CHAT_MODEL_SELECT_TRIGGER));
    await trigger.waitForClickable({ timeout: 30000 });
    await trigger.click();
    const connection = $('[data-testid="composer-provider-trigger"]');
    await connection.waitForDisplayed({ timeout: 15000 });
    expect(await $('[data-testid="composer-provider-trigger"]').getText()).toContain("BigModel");
    expect(await $('[data-testid="composer-connection-trigger"]').isExisting()).toBe(false);
    const slider = $('[data-testid="composer-thought-slider"]');
    await slider.waitForDisplayed({ timeout: 10000 });
    await slider.click();
    await browser.keys("Home");
    await browser.keys("ArrowRight");
    await browser.waitUntil(
      async () => Boolean(await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-thought")),
      { timeout: 10000 },
    );
    const chosenThought = await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-thought");
    await browser.execute(() => {
      const samples: unknown[] = [];
      const record = () => {
        const config = document.querySelector('[data-testid="v4-model-config"]');
        const slider = document.querySelector('[data-testid="composer-thought-slider"]');
        samples.push({
          at: performance.now(),
          provider: config?.getAttribute("data-provider"),
          thought: config?.getAttribute("data-thought"),
          levels: config?.getAttribute("data-thought-levels"),
          effort: slider?.getAttribute("aria-valuetext"),
          title: document.querySelector('[data-testid="composer-provider-trigger"]')?.textContent,
          loading: Boolean(document.querySelector('[data-testid="composer-provider-loading"]')),
          busy: document
            .querySelector('[data-testid="composer-provider-trigger"]')
            ?.getAttribute("aria-busy"),
        });
      };
      const observer = new MutationObserver(record);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      Object.assign(window, {
        __composerSwitchProbe: { samples, stop: () => observer.disconnect() },
      });
      record();
    });
    await connection.click();
    const team = $('[aria-label="BigModel Team Org"]');
    await team.waitForDisplayed({ timeout: 10000 });
    expect(await $('[aria-label="BigModel Unavailable Team"]').isExisting()).toBe(false);
    await browser.saveScreenshot(
      join(process.env.CF_E2E_ARTIFACT_DIR!, "composer-connections-before.png"),
    );
    await team.click();
    await browser.waitUntil(
      async () =>
        (await readSettings()).providerFamilyConnectionSelections?.bigmodel?.kind ===
        "team-coding-plan",
      { timeout: 15000 },
    );
    await browser.waitUntil(
      async () =>
        (await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-provider")) ===
        BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
      { timeout: 15000 },
    );
    expect(await trigger.getAttribute("aria-expanded")).toBe("true");
    await connection.waitForClickable({ timeout: 15000 });
    const samples = await browser.execute(() => {
      const probe = (
        window as unknown as { __composerSwitchProbe: { samples: unknown[]; stop: () => void } }
      ).__composerSwitchProbe;
      probe.stop();
      return probe.samples;
    });
    await writeFile(
      join(process.env.CF_E2E_ARTIFACT_DIR!, "composer-switch-state.json"),
      JSON.stringify(samples, null, 2),
    );
    expect(samples.some((sample) => (sample as { loading?: boolean }).loading)).toBe(true);
    expect(
      samples
        .filter((sample) => (sample as { loading?: boolean }).loading)
        .every((sample) => (sample as { busy?: string }).busy === "true"),
    ).toBe(true);
    expect(await $('[data-testid="composer-provider-loading"]').isExisting()).toBe(false);
    expect(
      samples.every((sample) => {
        const state = sample as { thought?: string; effort?: string; levels?: string };
        return state.thought === chosenThought && Boolean(state.effort) && Boolean(state.levels);
      }),
    ).toBe(true);
    expect(await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-thought")).toBe(chosenThought);

    await connection.click();
    const selectedTeam = $('[aria-label="BigModel Team Org"]');
    await selectedTeam.waitForDisplayed({ timeout: 10000 });
    expect(await selectedTeam.getAttribute("aria-checked")).toBe("true");
    expect(await connection.getText()).toContain("Team Org");
    expect((await readSettings()).providerFamilyConnectionSelections?.bigmodel).toEqual({
      kind: "team-coding-plan",
      productId: "product-team-a",
      organizationId: "org-team-a",
      projectId: "proj-team-a",
    });
    await browser.saveScreenshot(
      join(process.env.CF_E2E_ARTIFACT_DIR!, "composer-connections-team.png"),
    );
    const personal = $(
      `[data-model-provider-key="registry-provider:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan}"]`,
    );
    await personal.click();
    await browser.waitUntil(
      async () =>
        (await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-provider")) ===
        BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      { timeout: 15000 },
    );
    await connection.waitForClickable({ timeout: 15000 });
    expect(await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-thought")).toBe(chosenThought);
    expect((await readSettings()).providerFamilyConnectionSelections?.bigmodel?.kind).toBe(
      "individual-coding-plan",
    );
    await browser.keys("Escape");
  });

  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`CTP-23: Team激活时SupplementPersonal入口使用Current语言 ${locale}`, async function () {
      this.timeout(120000);
      await prepareScenario("both", TEAM_PLAN_KEY, "none", "none", locale);
      const trigger = $(sel(TID_CHAT_MODEL_SELECT_TRIGGER));
      await trigger.waitForClickable({ timeout: 30000 });
      await trigger.click();
      const connection = $('[data-testid="composer-provider-trigger"]');
      await connection.click();
      const personalLabel = locale === "zh-CN" ? "个人" : "Individual";
      await $(`[aria-label="BigModel ${personalLabel}"]`).waitForDisplayed({ timeout: 10000 });
      expect(await $('[aria-label="BigModel Team Org"]').isDisplayed()).toBe(true);
      if (locale === "zh-CN")
        expect(await $('[aria-label="BigModel Individual"]').isExisting()).toBe(false);
      await browser.keys("Escape");
      await browser.keys("Escape");
    });
  }

  for (const direction of ["personal-to-team", "team-to-personal"] as const) {
    it(`CTP-22: 经过普通 API 切换账NumberConnect后ThinkingComplete ${direction}`, async function () {
      this.timeout(120000);
      const toTeam = direction === "personal-to-team";
      await prepareScenario("both", toTeam ? PERSONAL_PLAN_KEY : TEAM_PLAN_KEY);
      await selectRegistryProviderModelById(BIGMODEL_E2E_MODEL, {
        includePlainModelFallback: false,
        providerId: toTeam
          ? BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan
          : BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
      });
      const trigger = $(sel(TID_CHAT_MODEL_SELECT_TRIGGER));
      await trigger.waitForClickable({ timeout: 30000 });
      await trigger.click();
      const connection = $('[data-testid="composer-provider-trigger"]');
      await browser.execute(() => {
        let wasLoading = false;
        const read = () =>
          JSON.stringify({
            models: document.querySelector("[data-composer-model-list]")?.textContent,
            effort: document
              .querySelector('[data-testid="composer-thought-slider"]')
              ?.getAttribute("aria-valuetext"),
          });
        let previous = read();
        const probe = {
          count: 0,
          samples: [] as { loading: boolean; display: string; previous: string }[],
          stop: () => {},
        };
        const observer = new MutationObserver(() => {
          const loading = Boolean(
            document.querySelector('[data-testid="composer-provider-loading"]'),
          );
          if (loading && !wasLoading) probe.count++;
          const display = read();
          probe.samples.push({ loading, display, previous });
          if (!loading) previous = display;
          wasLoading = loading;
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true });
        probe.stop = () => observer.disconnect();
        Object.assign(window, { __connectionLoadingProbe: probe });
      });
      await connection.click();
      await $(
        `[data-composer-provider-list] [data-model-provider-key="registry-provider:${process.env.E2E_PROVIDER_ID}"]`,
      ).click();
      await browser.waitUntil(
        async () =>
          !(await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-provider"))?.startsWith(
            "account:",
          ),
      );
      await connection.waitForClickable({ timeout: 15000 });
      expect(await browser.execute(() => (window as any).__connectionLoadingProbe.count)).toBe(1);
      await connection.click();
      await $(
        toTeam
          ? '[aria-label="BigModel Team Org"]'
          : `[data-model-provider-key="registry-provider:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan}"]`,
      ).click();
      await connection.waitForClickable({ timeout: 15000 });
      await browser.waitUntil(
        async () =>
          (await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-provider")) ===
          (toTeam
            ? BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan
            : BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan),
        { timeout: 15000 },
      );
      expect(await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-thought")).not.toBe("");
      expect(
        await $('[data-testid="composer-thought-slider"]').getAttribute("aria-valuetext"),
      ).not.toContain("—");
      const probe = await browser.execute(() => {
        const probe = (window as any).__connectionLoadingProbe;
        probe.stop();
        return { count: probe.count, samples: probe.samples };
      });
      await writeFile(
        join(process.env.CF_E2E_ARTIFACT_DIR!, `connection-loading-${direction}.json`),
        JSON.stringify(probe, null, 2),
      );
      expect(probe.count).toBe(2);
      expect(await $('[role="alert"]').isExisting()).toBe(false);
      expect(
        probe.samples
          .filter((sample: any) => sample.loading)
          .every((sample: any) => sample.display === sample.previous),
      ).toBe(true);
      await browser.keys("Escape");
    });
  }

  it("CTP-21: Selecting model before parsing returns after thought tuning must not leave empty slot", async function () {
    this.timeout(120000);
    await prepareScenario("both", PERSONAL_PLAN_KEY);
    const trigger = $(sel(TID_CHAT_MODEL_SELECT_TRIGGER));
    await trigger.waitForClickable({ timeout: 30000 });
    await trigger.click();
    await $('[data-testid="composer-thought-slider"]').waitForDisplayed();
    await browser.execute(() => {
      const element = document.querySelector('[data-testid="v4-model-config"]')!;
      let fiber = (element as any)[
        Object.keys(element).find((key) => key.startsWith("__reactFiber"))!
      ];
      let service: any;
      while (fiber && !service) {
        service =
          fiber.memoizedProps?.value?.modelSelectionService ??
          fiber.memoizedProps?.services?.modelSelectionService;
        fiber = fiber.return;
      }
      if (!service) throw new Error("ModelSelectionService not found");
      const original = service.getView.bind(service);
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      service.getView = async (...args: any[]) => {
        await pending;
        return original(...args);
      };
      Object.assign(window, {
        __releaseSelectionRead: () => {
          service.getView = original;
          release();
        },
      });
    });
    try {
      const slider = $('[data-testid="composer-thought-slider"]');
      await slider.click();
      await browser.keys("Home");
      expect(await $('[data-testid="composer-provider-loading"]').isExisting()).toBe(false);
      await writeFile(
        join(process.env.CF_E2E_ARTIFACT_DIR!, "reasoning-read-menu.json"),
        JSON.stringify(
          await browser.execute(() => ({
            config: (document.querySelector('[data-testid="v4-model-config"]') as HTMLElement)
              ?.dataset,
            menu: Array.from(document.querySelectorAll('[role="menu"]')).map((e) => e.textContent),
          })),
          null,
          2,
        ),
      );
      const flash = (await $$('[data-composer-model-list] [role="menuitemradio"]'))[1]!;
      await flash.click();
      await browser.waitUntil(
        async () =>
          (await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-model")) === "GLM-5.3-Flash",
      );
      expect(await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-thought")).not.toBe("");
    } finally {
      await browser.execute(() => (window as any).__releaseSelectionRead());
    }
    await $('[data-testid="composer-thought-slider"]').waitForDisplayed();
    expect(await $(sel(TID_V4_MODEL_CONFIG)).getAttribute("data-thought")).not.toBe("");
    await browser.keys("Escape");
  });

  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`CTP-02B: Sidebar头像菜单应ShowCurrent已确认的 Team Plan Tags（${locale}）`, async function () {
      this.timeout(120000);

      await prepareScenario("teamOnly", TEAM_PLAN_KEY, "none", "none", locale);
      await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60000);

      const profileTrigger = $(sel(TID_LOGIN_TRIGGER));
      await profileTrigger.waitForDisplayed({
        timeout: 30000,
        timeoutMsg: "侧栏头像入口没有出现",
      });
      const teamLabel = locale === "zh-CN" ? "团队" : "Team";
      await profileTrigger.click();
      const badge = $('[data-testid="profile-menu-plan"]').$(`span[title="${teamLabel}"]`);
      await badge.waitForDisplayed({ timeout: 30000 });
      await expect(badge).toHaveText(teamLabel);
      await browser.keys("Escape");
    });
  }

  it("CTP-03: User avatar menu should navigate to Team Plan usage statistics and request team quota", async function () {
    this.timeout(120000);

    await prepareScenario("teamOnly", TEAM_PLAN_KEY);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60000);
    await openSidebarUsageStats();

    await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
    await clickUsageCodingPlanTab(TEAM_PLAN_KEY);
    await assertBodyTextIncludes(["Team Org", "90%"]);
    await waitForMockRequest(
      (request) =>
        request.path.endsWith("/api/monitor/usage/quota/limit") &&
        request.query.type === "2" &&
        request.headers["bigmodel-organization"] === "org-team-a" &&
        request.headers["bigmodel-project"] === "proj-team-a",
      "Avatar menu did not request quota/limit?type=2 according to Team Plan",
    );
  });

  it("CTP-04: Usage statistics coding plan should display Team Plan quota, model usage, and tool usage", async function () {
    this.timeout(120000);

    await prepareScenario("teamOnly", TEAM_PLAN_KEY);
    await openUsageCodingPlanTab(TEAM_PLAN_KEY);

    await assertBodyTextIncludes(["Team Org", "90%", "glm-credit-e2e"]);
    await assertBodyTextIncludesAny(["Models", "模型"]);
    await clickVisibleButtonByText(["工具", "Tools"]);
    await assertBodyTextIncludes(["E2E Search MCP"]);
    await waitForMockRequest(
      (request) =>
        request.path.endsWith("/api/monitor/credit-usage/usage-detail") &&
        request.query.usageType === "MODEL" &&
        request.headers["bigmodel-organization"] === "org-team-a" &&
        request.headers["bigmodel-project"] === "proj-team-a",
      "Usage statistics did not request MODEL credit detail according to Team Plan",
    );
    await waitForMockRequest(
      (request) =>
        request.path.endsWith("/api/monitor/credit-usage/usage-detail") &&
        request.query.usageType === "MCP" &&
        request.headers["bigmodel-organization"] === "org-team-a" &&
        request.headers["bigmodel-project"] === "proj-team-a",
      "Usage statistics did not request MCP credit detail according to Team Plan",
    );
  });

  it("CTP-04B: 个人套餐应展示 credit activity、明细与性能数据", async function () {
    this.timeout(120000);

    await prepareScenario("personalOnly", PERSONAL_PLAN_KEY);
    await openUsageCodingPlanTab(PERSONAL_PLAN_KEY);

    await assertBodyTextIncludes(["glm-credit-e2e"]);
    await assertBodyTextIncludesAny(["Credits total", "积分总数"]);
    await clickVisibleButtonByText(["工具", "Tools"]);
    await assertBodyTextIncludes(["E2E Search MCP"]);
    await waitForMockRequest(
      (request) =>
        request.path.endsWith("/api/monitor/credit-usage/activity") &&
        request.query.type === "1" &&
        !request.headers["bigmodel-organization"] &&
        !request.headers["bigmodel-project"],
      "个人套餐没有请求隔离的 credit activity",
    );
    await waitForMockRequest(
      (request) =>
        request.path.endsWith("/api/monitor/credit-usage/usage-detail") &&
        request.query.usageType === "MODEL",
      "个人套餐没有请求 MODEL credit detail",
    );
    await waitForMockRequest(
      (request) => request.path.endsWith("/api/monitor/usage/model-performance-day"),
      "个人套餐没有请求 model performance",
    );
  });

  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`CTP-05: 切换Connect后可分别ViewPersonal与Team用量Source（${locale}）`, async function () {
      this.timeout(180000);

      await prepareScenario("both", TEAM_PLAN_KEY, "none", "none", locale);
      await openModelProviderSettings();
      await clickVisibleTestIdByDom(testId(TID_MODEL_PROVIDER_NAV_ITEM, BIGMODEL_ACCOUNT_NAV_KEY), {
        timeout: 30000,
        timeoutMsg: "BigModel provider navigation item did not appear",
      });
      await selectConnectionModeOptionByTestId(
        testId(TID_MODEL_PROVIDER_CONNECTION_MODE_ITEM, PERSONAL_PLAN_CONNECTION_KEY),
        "个人 Coding Plan",
      );
      await waitForBigModelConnectionSelection("individual-coding-plan");
      await openUsageCodingPlanTab(PERSONAL_PLAN_KEY);
      await assertBodyTextIncludes(["70%", "glm-credit-e2e"]);
      const personalTab = $(sel(testId(TID_SETTINGS_USAGE_TAB, `codingPlan:${PERSONAL_PLAN_KEY}`)));
      await expect(personalTab).toHaveText(locale === "zh-CN" ? "个人套餐" : "Individual Plan");
      await expect(personalTab).toHaveAttribute("aria-pressed", "true");
      const teamTab = $(sel(testId(TID_SETTINGS_USAGE_TAB, `codingPlan:${TEAM_PLAN_KEY}`)));
      await teamTab.waitForDisplayed({ timeout: 30_000 });
      await expect(teamTab).toHaveText("Team Org");
      await expect(teamTab).toHaveAttribute("aria-pressed", "false");

      await openModelProviderSettings();
      await clickVisibleTestIdByDom(testId(TID_MODEL_PROVIDER_NAV_ITEM, BIGMODEL_ACCOUNT_NAV_KEY), {
        timeout: 30000,
        timeoutMsg: "BigModel provider navigation item did not appear",
      });
      await selectConnectionModeOptionByTestId(
        testId(TID_MODEL_PROVIDER_CONNECTION_MODE_ITEM, TEAM_PLAN_KEY),
        "Team Org",
      );
      await waitForBigModelConnectionSelection("team-coding-plan");
      await openUsageCodingPlanTab(TEAM_PLAN_KEY);
      await assertBodyTextIncludes(["Team Org", "90%", "glm-credit-e2e"]);
    });
  }

  it("CTP-06: Selected Team Plan should be preserved when resuming OAuth", async function () {
    this.timeout(120000);

    await prepareScenario("both", TEAM_PLAN_KEY);
    await waitForMockRequest(
      (request) => request.path.endsWith("/subscription/enterprise/v2/pricing"),
      "Enterprise plan pricing was not requested when resuming OAuth",
    );
    await browser.waitUntil(
      async () => {
        const selection = (await readSettings()).providerFamilyConnectionSelections?.bigmodel;
        return (
          selection?.kind === "team-coding-plan" &&
          selection.productId === "product-team-a" &&
          selection.organizationId === "org-team-a" &&
          selection.projectId === "proj-team-a"
        );
      },
      {
        timeout: 15000,
        timeoutMsg: "Structured Team Plan selection was overwritten after resuming OAuth",
      },
    );

    await openUsageCodingPlanTab(TEAM_PLAN_KEY);
    await waitForMockRequest(
      (request) =>
        request.path.endsWith("/api/monitor/usage/quota/limit") &&
        request.query.type === "2" &&
        request.headers["bigmodel-organization"] === "org-team-a" &&
        request.headers["bigmodel-project"] === "proj-team-a",
      "Usage statistics did not continue requesting quota/limit?type=2 for Team Plan after resuming OAuth",
    );
  });

  it("CTP-07: Switching between 7d and 30d should re-request different date windows while preserving the current source", async function () {
    this.timeout(120000);

    await prepareScenario("both", TEAM_PLAN_KEY);
    await openUsageCodingPlanTab(TEAM_PLAN_KEY);
    await clickVisibleButtonByText(["30 days", "Last 30 Days"]);
    const thirtyDayRequest = await waitForLatestMockRequest(
      (request) =>
        request.path.endsWith("/api/monitor/credit-usage/usage-detail") &&
        request.query.usageType === "MODEL" &&
        request.query.type === "3" &&
        requestRangeDays(request) === 29,
      "切换 30d 后没有请求新的日期窗口",
    );

    expect(thirtyDayRequest.headers["bigmodel-organization"]).toBe("org-team-a");
    expect(thirtyDayRequest.headers["bigmodel-project"]).toBe("proj-team-a");
    expect(
      daysBetweenMonitorTimes(
        requireQueryValue(thirtyDayRequest, "startTime"),
        requireQueryValue(thirtyDayRequest, "endTime"),
      ),
    ).toBe(29);

    await clickVisibleButtonByText(["7 days", "Last 7 Days"]);
    await waitForMockRequest(
      (request) =>
        request.path.endsWith("/api/monitor/credit-usage/usage-detail") &&
        request.query.usageType === "MODEL" &&
        request.query.type === "3" &&
        requestRangeDays(request) === 6,
      "切回 7d 后没有恢复对应日期窗口",
    );
  });

  it("CTP-08: Usage tabs, range, and heatmap should remain operable in narrow viewports", async function () {
    this.timeout(120000);
    await setRendererViewport(430, 760);
    try {
      await prepareScenario("personalOnly", PERSONAL_PLAN_KEY);
      await setSettingsTheme("cf-dark");
      await openUsageCodingPlanTab(PERSONAL_PLAN_KEY);
      await clickVisibleButtonByText(["30 days", "Last 30 Days"]);
      await assertBodyTextIncludes(["glm-credit-e2e"]);
      await assertBodyTextIncludesAny(["Token activity", "Token 活动"]);
    } finally {
      await setSettingsTheme("cf-light");
      await clearRendererViewport();
    }
  });

  it("CTP-09: Failure of optional activity endpoint should not break quota and should recover upon refresh", async function () {
    this.timeout(120000);
    await prepareScenario("personalOnly", PERSONAL_PLAN_KEY, "optionalActivity");
    await openUsageCodingPlanTab(PERSONAL_PLAN_KEY);

    await assertBodyTextIncludes(["70%", "glm-credit-e2e"]);
    await assertBodyTextExcludes(["350.7K", "35.1万", "35.1 万"]);
    await setMockScenario("personalOnly", "none");
    await clickVisibleButtonByText(["刷新", "Refresh"]);
    await assertBodyTextIncludesAny(["350.7K", "35.1万", "35.1 万"]);
    await waitForMockRequest(
      (request) => request.path.endsWith("/api/monitor/credit-usage/activity"),
      "Did not re-request upon refresh after activity recovered",
    );
  });

  it("CTP-10: Context hover should display the same quota snapshot based on access freshness", async function () {
    this.timeout(120000);
    await prepareScenario("personalOnly", PERSONAL_PLAN_KEY);
    await selectBigModelCodingPlanRuntime("individual-coding-plan");
    const trigger = await $(sel(TID_CHAT_CONTEXT_USAGE_TRIGGER));
    await trigger.waitForDisplayed({
      timeout: 15000,
      timeoutMsg: "Context usage trigger 没有出现",
    });
    await trigger.moveTo();
    await assertBodyTextIncludes(["70%"]);
    await assertBodyTextIncludesAny(["5 小时", "5 Hours"]);
    await waitForMockRequest(
      (request) =>
        request.path.endsWith("/api/monitor/usage/quota/limit") && request.query.type !== "2",
      "Context access 没有读取个人套餐 quota",
    );
  });

  for (const [scenario, planKey, width] of [
    ["personalOnly", PERSONAL_PLAN_KEY, 1200],
    ["teamOnly", TEAM_PLAN_KEY, 1200],
    ["personalOnly", PERSONAL_PLAN_KEY, 390],
    ["teamOnly", TEAM_PLAN_KEY, 390],
  ] as const) {
    it(`CTP-11: ${scenario} ${width}px quota FailedRetain套餐入口，重New进入Source后恢复`, async function () {
      this.timeout(120000);
      await prepareScenario(scenario, planKey, "quotaBusinessFailure");
      await openUsageSection();
      await setRendererViewport(width, 900);
      await setMockScenario(scenario, "quotaFailure");
      await clickUsageCodingPlanTab(planKey);
      await assertBodyTextIncludesAny([
        "Unable to load usage stats",
        "Unable to load usage statistics. Please try again later, or check your network and provider settings.",
      ]);
      await assertBodyTextExcludes(["350.7K", "35.1万", "35.1 万", "glm-credit-e2e"]);

      await setMockScenario(scenario, "none");
      await clickVisibleTestIdByDom(testId(TID_SETTINGS_USAGE_TAB, "app"), {
        timeout: 10000,
        timeoutMsg: "Unable to switch to App Usage when recovering from fatal failure",
      });
      await clickUsageCodingPlanTab(planKey);
      await assertBodyTextIncludes([scenario === "teamOnly" ? "90%" : "70%", "glm-credit-e2e"]);
      await assertBodyTextIncludesAny(["350.7K", "35.1万", "35.1 万"]);
    });
  }

  it("QR-E2E-01: Empty state should call opportunity and display opportunities with forced status results", async function () {
    this.timeout(120000);
    await prepareScenario("personalOnly", PERSONAL_PLAN_KEY, "none", "emptyThenGrant");
    await openUsageCodingPlanTab(PERSONAL_PLAN_KEY);

    await waitForMockRequest(
      (request) => request.path.endsWith("/api/v1/coding-plan/reset/opportunity"),
      "空 reset 状态没有触发 opportunity",
    );
    await waitForResetOpportunityCount(1);

    const resetPaths = (await readMockRequests())
      .map((request) => request.path)
      .filter((path) => path.includes("/api/v1/coding-plan/reset/"));
    const opportunityIndex = resetPaths.findIndex((path) => path.endsWith("/opportunity"));
    expect(opportunityIndex).toBeGreaterThan(0);
    expect(resetPaths.slice(opportunityIndex + 1).some((path) => path.endsWith("/status"))).toBe(
      true,
    );

    await clickResetOpportunityBadge();
    await assertBodyTextIncludesAny(["可重置额度", "Resettable quota"]);
    await assertBodyTextIncludesAny(["5 小时额度重置", "5-hour quota reset"]);
  });

  it("QR-E2E-02: Should still call opportunity when multiple opportunity types exist, and Dialog should only display the authoritative count from status", async function () {
    this.timeout(120000);
    await prepareScenario("personalOnly", PERSONAL_PLAN_KEY, "none", "existingMultiple");
    await openUsageCodingPlanTab(PERSONAL_PLAN_KEY);

    await waitForMockRequest(
      (request) => request.path.endsWith("/api/v1/coding-plan/reset/opportunity"),
      "Did not continue triggering scope opportunity when reset opportunities already exist",
    );
    await waitForResetOpportunityCount(3);
    await clickResetOpportunityBadge();
    await assertBodyTextIncludesAny(["可重置额度", "Resettable quota"]);
    await assertBodyTextIncludesAny(["5 小时额度重置", "5-hour quota reset"]);
    await assertBodyTextIncludesAny(["周额度重置", "Weekly quota reset"]);
    await assertBodyTextIncludesAny(["2 次", "×2"]);
  });

  it("QR-E2E-09: Composer should persistently display first-time opportunity reminder and collapse on hover", async function () {
    this.timeout(120000);
    await prepareScenario("personalOnly", PERSONAL_PLAN_KEY, "none", "existingMultiple");
    await reloadRendererWithBigModelCodingPlanSelection();

    await waitForContextResetReminder("initial", ["3 Quota Resets", "3 reset available"]);
    await assertContextReminderHiddenInSettings("initial");
    const trigger = await $(sel(TID_CHAT_CONTEXT_USAGE_TRIGGER));
    await trigger.moveTo();
    await browser.waitUntil(async () => !(await isContextResetReminderVisible("initial")), {
      timeout: 10000,
      timeoutMsg: "First-time reset opportunity reminder did not collapse after opening Context",
    });
  });

  it("QR-E2E-10: Persistent expiring reminder should be displayed when earliest opportunity enters the last 3 minutes", async function () {
    this.timeout(120000);
    await prepareScenario("personalOnly", PERSONAL_PLAN_KEY, "none", "urgentOpportunity");
    await reloadRendererWithBigModelCodingPlanSelection();

    await waitForContextResetReminder("urgent", ["重置额度过期", "Reset expires in"]);
    await assertContextReminderHiddenInSettings("urgent");
    const alarmAnimation = await browser.execute(() => {
      const icon = document.querySelector<HTMLElement>(
        '[data-context-reset-reminder="urgent"] .animate-cf-alarm-ring',
      );
      return icon ? window.getComputedStyle(icon).animationName : null;
    });
    expect(alarmAnimation).toBe("cf-alarm-ring");
  });

  it("QR-E2E-04: Composer Dialog 打开期间应保持 HoverCard 生命周期", async function () {
    this.timeout(120000);
    await prepareScenario("personalOnly", PERSONAL_PLAN_KEY, "none", "existingMultiple");
    await selectBigModelCodingPlanRuntime("individual-coding-plan");

    const trigger = await $(sel(TID_CHAT_CONTEXT_USAGE_TRIGGER));
    await trigger.waitForDisplayed({
      timeout: 15000,
      timeoutMsg: "Context usage trigger 没有出现",
    });
    await trigger.moveTo();
    await waitForResetOpportunityCount(3, '[data-slot="hover-card-content"]');
    await clickResetOpportunityBadge('[data-slot="hover-card-content"]');

    await browser.waitUntil(
      async () => {
        const state = await readQuotaResetOverlayState();
        return state.dialogVisible && state.hoverCardVisible;
      },
      {
        timeout: 10000,
        timeoutMsg: "重置 Dialog 打开后 Composer HoverCard 被提前卸载",
      },
    );

    await browser.keys("Escape");
    await browser.waitUntil(
      async () => {
        const state = await readQuotaResetOverlayState();
        return !state.dialogVisible && !state.hoverCardVisible;
      },
      {
        timeout: 10000,
        timeoutMsg: "Composer HoverCard did not collapse together after closing reset Dialog",
      },
    );
  });

  it("QR-E2E-03: FIVE_HOUR use must wait for status used_at to complete", async function () {
    this.timeout(120000);
    await prepareScenario("personalOnly", PERSONAL_PLAN_KEY, "none", "fiveHourUse");
    await openUsageCodingPlanTab(PERSONAL_PLAN_KEY);
    await waitForResetOpportunityCount(2);
    await clickResetOpportunityBadge();

    const resetButton = await findVisibleButtonByAriaLabels(
      ["Reset 5-Hour Quota", "重置 5 小时额度"],
      true,
      '[role="dialog"]',
    );
    if (!resetButton) throw new Error("Could not find FIVE_HOUR reset button");
    await resetButton.click();
    await waitForMockRequest(
      (request) =>
        request.path.endsWith("/api/v1/coding-plan/reset/use") &&
        isRecord(request.body) &&
        request.body.reset_type === "FIVE_HOUR",
      "五小时重置没有发送 reset_type=FIVE_HOUR",
    );
    const useRequest = (await readMockRequests()).find((request) =>
      request.path.endsWith("/api/v1/coding-plan/reset/use"),
    );
    expect(useRequest?.headers.authorization).toBe("Bearer e2e-cf-jwt");
    expect(useRequest?.headers["x-bigmodel-authorization"]).toBe("e2e-bigmodel-oauth-token");
    const processingState = await readDialogResetState();
    if (processingState.resetDisabled !== true || processingState.successVisible) {
      throw new Error(
        `status used_at 未确认前没有保持 processing: ${JSON.stringify(processingState)}`,
      );
    }

    await confirmResetUse();
    await browser.waitUntil(async () => (await readDialogResetState()).successVisible, {
      interval: 100,
      timeout: 10000,
      timeoutMsg: "Success status was not displayed after status used_at was updated",
    });
    await waitForMockRequest(
      (request) => request.path.endsWith("/api/v1/coding-plan/reset/history/read"),
      "Did not report history/read after confirming reset used_at",
    );
  });

  it("QR-E2E-14: 同类型多张机会核销一张后，弹框不重开即可展示并核销余下机会", async function () {
    this.timeout(120000);
    await prepareScenario("personalOnly", PERSONAL_PLAN_KEY, "none", "multiFiveHourUse");
    await openUsageCodingPlanTab(PERSONAL_PLAN_KEY);
    await waitForResetOpportunityCount(3);
    await clickResetOpportunityBadge();
    await assertBodyTextIncludesAny(["2 次", "×2"]);

    await clickDialogFiveHourReset("Could not find FIVE_HOUR reset button");
    await browser.waitUntil(async () => (await readFiveHourUseRequests()).length === 1, {
      timeout: 10000,
      timeoutMsg: "第一次五小时重置没有发送 /use",
    });

    await waitForDialogResetState(
      (state) =>
        state.resetDisabled === false &&
        !state.successVisible &&
        state.weekResetVisible &&
        state.resetRowText !== null &&
        !["2 次", "×2", "0m 0s", "0m 0s"].some((text) => state.resetRowText?.includes(text)),
      "Remaining opportunities did not directly become redeemable in the dialog after redeeming one",
    );

    await clickDialogFiveHourReset("Could not find FIVE_HOUR reset button for remaining opportunities after redeeming one");
    await browser.waitUntil(async () => (await readFiveHourUseRequests()).length === 2, {
      timeout: 10000,
      timeoutMsg: "余下机会的再次点击没有真实发送 /use",
    });
    const idempotencyKeys = (await readFiveHourUseRequests()).map((request) =>
      isRecord(request.body) ? request.body.idempotency_key : undefined,
    );
    expect(new Set(idempotencyKeys).size).toBe(2);

    await waitForDialogResetState(
      (state) => state.resetDisabled === null && !state.successVisible && state.weekResetVisible,
      "Row did not collapse after 5-hour opportunities were exhausted",
    );
    expect(
      (await readMockRequests()).some(
        (request) =>
          request.path.endsWith("/api/v1/coding-plan/reset/use") &&
          isRecord(request.body) &&
          request.body.reset_type === "WEEK",
      ),
    ).toBe(false);
  });

  it("QR-E2E-15: When redeeming again from completed state, status remains previous used_at, success is confirmed only after reading new used_at", async function () {
    this.timeout(120000);
    await prepareScenario("personalOnly", PERSONAL_PLAN_KEY, "none", "multiFiveHourUseLagging");
    await openUsageCodingPlanTab(PERSONAL_PLAN_KEY);
    await waitForResetOpportunityCount(3);
    await clickResetOpportunityBadge();
    await assertBodyTextIncludesAny(["2 次", "×2"]);

    await clickDialogFiveHourReset("Could not find FIVE_HOUR reset button");
    await browser.waitUntil(async () => (await readFiveHourUseRequests()).length === 1, {
      timeout: 10000,
      timeoutMsg: "第一次五小时重置没有发送 /use",
    });
    await waitForDialogResetState(
      (state) => state.resetDisabled === false && !state.successVisible && state.weekResetVisible,
      "Remaining opportunities did not become redeemable after the first redemption",
    );

    await clickDialogFiveHourReset("Could not find FIVE_HOUR reset button for remaining opportunities after redeeming one");
    await browser.waitUntil(async () => (await readFiveHourUseRequests()).length === 2, {
      timeout: 10000,
      timeoutMsg: "余下机会的再次点击没有真实发送 /use",
    });

    let revertedToClickable = false;
    await waitForDialogResetState((state) => {
      revertedToClickable ||= state.resetDisabled === false;
      return state.resetDisabled === null && !state.successVisible && state.weekResetVisible;
    }, "完成态再次核销后五小时行没有随机会耗尽收起");
    expect(revertedToClickable).toBe(false);
    expect(await readFiveHourUseRequests()).toHaveLength(2);
  });
});

async function prepareScenario(
  scenario: CodingPlanScenario,
  bigmodelSelectedKey: string,
  faultMode: CodingPlanFaultMode = "none",
  resetScenario: CodingPlanResetScenario = "none",
  locale?: "zh-CN" | "en-US",
  loggedOut = false,
) {
  await clearUsageEntitlementCache();
  await quitElectronAppGracefully();
  await setMockScenario(scenario, faultMode);
  await setResetMockScenario(resetScenario);
  await writeCredentials({
    "oauth:active_provider": "bigmodel",
    "oauth:bigmodel:access_token": "e2e-bigmodel-oauth-token",
    "oauth:bigmodel:user_info": JSON.stringify({
      displayName: "BigModel E2E",
      id: "bigmodel-e2e-user",
      username: "bigmodel-e2e-user",
    }),
    cfjwttoken:
      resetScenario === "none" &&
      !faultMode.startsWith("startBalance") &&
      faultMode !== "expiredTeam"
        ? ""
        : "e2e-cf-jwt",
  });
  if (loggedOut)
    await writeCredentials({
      "oauth:active_provider": "",
      "oauth:bigmodel:access_token": "",
      "oauth:bigmodel:user_info": "",
      "oauth:zai:access_token": "",
      "oauth:zai:user_info": "",
      cfjwttoken: "",
    });
  const connectionSelection = parseBigModelConnectionSelection(bigmodelSelectedKey);
  await writeSettings({
    ...(locale ? { locale, localePreference: locale } : {}),
    providerFamilyConnectionSelections: {
      bigmodel: connectionSelection,
    },
    providerFamilyDomain: "bigmodel",
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
  await skipOccupationOnboardingIfPresent();
  await waitForDefaultWorkspaceReady(60000);
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60000);
  await closeTransientOverlays();
  await waitForProviderConfigPolling();
}

function parseBigModelConnectionSelection(selectedKey: string) {
  if (selectedKey === BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan)
    return { kind: "start-plan" as const };
  const parts = selectedKey.split(":");
  if (parts[0] !== "team") {
    return { kind: "individual-coding-plan" as const };
  }
  const [, family, productId, organizationId, projectId] = parts;
  if (family !== "bigmodel" || !productId || !organizationId || !projectId) {
    throw new Error(`无效 Team Plan key: ${selectedKey}`);
  }
  return {
    kind: "team-coding-plan" as const,
    productId,
    organizationId,
    projectId,
  };
}

async function waitForBigModelConnectionSelection(
  kind: "individual-coding-plan" | "team-coding-plan",
) {
  await browser.waitUntil(
    async () => (await readSettings()).providerFamilyConnectionSelections?.bigmodel?.kind === kind,
    {
      timeout: 15000,
      timeoutMsg: `BigModel Connect方式没有收敛到 ${kind}`,
    },
  );
  await waitForProviderConfigPolling();
}

async function clearUsageEntitlementCache() {
  try {
    await browser.execute(() => {
      const prefix = "cf:usage-entitlement:";
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith(prefix)) {
          window.localStorage.removeItem(key);
        }
      }
    });
  } catch {
  }
}

async function openModelProviderSettings() {
  await closeTransientOverlays();
  await ensureSettingsPageOpen();
  await clickVisibleTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"), {
    timeout: 10000,
    timeoutMsg: "设置页没有出现模型供应商分区入口",
  });
}

async function assertConnectionModeOptionsInclude(
  expectedOptions: Array<{ key: string; labels: string[] }>,
) {
  await openConnectionModeSelect();
  try {
    for (const expectedOption of expectedOptions) {
      const optionTestId = testId(TID_MODEL_PROVIDER_CONNECTION_MODE_ITEM, expectedOption.key);
      const option = await $(sel(optionTestId));
      await option.waitForDisplayed({
        timeout: 10000,
        timeoutMsg: `没有找到Connect方式选项: ${optionTestId}`,
      });
      const optionText = await option.getText();
      expect(expectedOption.labels.some((label) => optionText.includes(label))).toBe(true);
    }
  } finally {
    await browser.keys("Escape");
  }
}

async function selectConnectionModeOptionByTestId(optionTestId: string, labelForError: string) {
  await openConnectionModeSelect();
  const option = await $(sel(optionTestId));
  await option.waitForDisplayed({
    timeout: 10000,
    timeoutMsg: `没有找到Connect方式选项: ${labelForError}`,
  });
  await option.click();
}

async function openConnectionModeSelect() {
  await clickVisibleTestIdByDom(TID_MODEL_PROVIDER_CONNECTION_MODE_TRIGGER, {
    timeout: 10000,
    timeoutMsg: "连接方式选择器没有出现",
  });
}

async function openUsageCodingPlanTab(sourceId?: string) {
  await openUsageSection();
  await clickUsageCodingPlanTab(sourceId);
  await assertBodyTextIncludesAny(["Remaining Quota", "Quota remaining", "Quota Remaining"]);
}

async function openUsageSection() {
  await closeTransientOverlays();
  await ensureSettingsPageOpen();
  await clickVisibleTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "usage"), {
    timeout: 10000,
    timeoutMsg: "设置页没有出现使用统计分区入口",
  });
}

async function ensureSettingsPageOpen() {
  const settingsPage = $(sel(TID_SETTINGS_PAGE));
  if (!(await settingsPage.isDisplayed().catch(() => false))) {
    await clickVisibleTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
      timeout: 10000,
      timeoutMsg: "Could not find settings entry button",
    });
    await settingsPage.waitForDisplayed({ timeout: 10000 });
  }
}

async function openSidebarUsageStats() {
  await closeTransientOverlays();
  await clickVisibleTestIdByDom(TID_LOGIN_TRIGGER, {
    timeout: 10000,
    timeoutMsg: "Could not find avatar menu entry",
  });
  await clickVisibleTestIdByDom(TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON, {
    timeout: 10000,
    timeoutMsg: "Could not find usage statistics entry in avatar menu",
  });
}

async function closeTransientOverlays() {
  await browser.keys("Escape");
  await browser.pause(100);
}

async function clickUsageCodingPlanTab(sourceId?: string) {
  const staticTabId = testId(TID_SETTINGS_USAGE_TAB, "codingPlan");
  const prefix = `${testId(TID_SETTINGS_USAGE_TAB, "codingPlan:")}`;
  const preferredTabId = sourceId ? testId(TID_SETTINGS_USAGE_TAB, `codingPlan:${sourceId}`) : null;
  let selectedTestId = "";
  try {
    await browser.waitUntil(
      async () => {
        selectedTestId = (await browser.execute(
          (legacyTestId, dynamicPrefix, targetTestId) => {
            const candidates = Array.from(
              document.querySelectorAll<HTMLElement>("[data-testid]"),
            ).filter((element) => {
              const current = element.dataset.testid ?? "";
              return current === legacyTestId || current.startsWith(dynamicPrefix);
            });
            const ordered = targetTestId
              ? candidates.filter((element) => element.dataset.testid === targetTestId)
              : candidates;
            const visible = ordered.find((element) => {
              const style = window.getComputedStyle(element);
              return !(
                style.display === "none" ||
                style.visibility === "hidden" ||
                Number(style.opacity) === 0 ||
                element.getClientRects().length === 0 ||
                element.closest('[aria-hidden="true"], [hidden]')
              );
            });
            return visible?.dataset.testid ?? "";
          },
          staticTabId,
          prefix,
          preferredTabId,
        )) as string;
        return Boolean(selectedTestId);
      },
      {
        timeout: 30000,
        timeoutMsg: "设置页没有出现使用统计 Coding Plan tab",
      },
    );
    const tab = await $(sel(selectedTestId));
    await tab.click();
  } catch (error) {
    throw new Error(
      `Settings页没有出现or无法激活 Coding Plan tab: ${selectedTestId}\n${await collectCodingPlanUsageDiagnostics()}`,
      { cause: error },
    );
  }
}

async function setRendererViewport(width: number, height: number) {
  await sendRendererEmulationCommand("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height,
    mobile: false,
    width,
  });
  await browser.waitUntil(
    async () => browser.execute((expectedWidth) => window.innerWidth === expectedWidth, width),
    { timeout: 10000, timeoutMsg: `renderer viewport 没有收敛到 ${width}px` },
  );
}

async function setSettingsTheme(theme: "cf-light" | "cf-dark") {
  const changed = await browser.execute((nextTheme) => {
    const actions = (window as typeof window & { __testActions?: Record<string, unknown> })
      .__testActions;
    const setTheme = actions?.setTheme;
    if (typeof setTheme !== "function") return false;
    (setTheme as (value: string) => void)(nextTheme);
    return true;
  }, theme);
  expect(changed).toBe(true);
}

async function clearRendererViewport() {
  await sendRendererEmulationCommand("Emulation.clearDeviceMetricsOverride");
}

async function sendRendererEmulationCommand(method: string, params: Record<string, unknown> = {}) {
  const sent = await browser.electron.execute(
    async (electron, command, commandParams) => {
      const window = electron.BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed() && candidate.isVisible(),
      );
      if (!window) return false;
      const devtools = window.webContents.debugger;
      if (!devtools.isAttached()) devtools.attach("1.3");
      await devtools.sendCommand(command, commandParams);
      return true;
    },
    method,
    params,
  );
  expect(sent).toBe(true);
}

async function collectCodingPlanUsageDiagnostics() {
  const providers = (await readModelProviders()).map((provider) => ({
    id: provider.id,
    enabled: provider.enabled,
    hasApiKey: provider.apiKey.trim().length > 0,
    systemDisabledReason: provider.systemDisabledReason ?? null,
  }));
  const requests = (await readMockRequests()).map((request) => ({
    path: request.path,
    query: request.query,
    organization: request.headers["bigmodel-organization"] ?? null,
    project: request.headers["bigmodel-project"] ?? null,
  }));
  return `Diagnostics: ${JSON.stringify(
    {
      bodyText: (await getBodyText()).slice(0, 2000),
      providers,
      requests,
    },
    null,
    2,
  )}`;
}

async function clickVisibleTestIdByDom(
  currentTestId: string,
  { timeout = 10000, timeoutMsg = `Pages没有可见的 test id: ${currentTestId}` } = {},
) {
  let latestReason = "not-started";
  await browser.waitUntil(
    async () => {
      const result = (await browser.execute((targetTestId) => {
        function isVisible(element: HTMLElement) {
          const style = window.getComputedStyle(element);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity) === 0
          ) {
            return false;
          }
          if (element.getClientRects().length === 0) {
            return false;
          }
          return !element.closest('[aria-hidden="true"], [hidden]');
        }

        function dispatchE2EActivation(element: HTMLElement) {
          element.focus();
          const pointerEventCtor = window.PointerEvent ?? MouseEvent;
          for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
            const event =
              type.startsWith("pointer") && pointerEventCtor === window.PointerEvent
                ? new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    pointerId: 1,
                    pointerType: "mouse",
                    isPrimary: true,
                  })
                : new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                  });
            element.dispatchEvent(event);
          }
        }

        const element = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
          (item) => item.dataset.testid === targetTestId && isVisible(item),
        );
        if (!element) {
          return { clicked: false, reason: "missing-visible" };
        }
        const disabled =
          (element instanceof HTMLButtonElement ||
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement) &&
          element.disabled;
        if (disabled) {
          return { clicked: false, reason: "disabled" };
        }
        dispatchE2EActivation(element);
        return { clicked: true };
      }, currentTestId)) as { clicked: boolean; reason?: string };
      latestReason = result.reason ?? "clicked";
      return result.clicked;
    },
    {
      timeout,
      timeoutMsg: `${timeoutMsg}: ${latestReason}`,
    },
  );
}

async function selectBigModelCodingPlanRuntime(
  planKind: "individual-coding-plan" | "team-coding-plan" = "individual-coding-plan",
) {
  const providerId =
    planKind === "team-coding-plan"
      ? "account:bigmodel-team-coding-plan"
      : "account:bigmodel-individual-coding-plan";
  await selectRegistryProviderModelById(BIGMODEL_E2E_MODEL, {
    includePlainModelFallback: false,
    providerId,
    providerName: "BigModel Coding Plan",
  });
}

async function reloadRendererWithBigModelCodingPlanSelection() {
  await seedPersistedModelSelection({
    modelId: BIGMODEL_E2E_MODEL,
    providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    reasoningLevel: "max",
  });
  await browser.execute(() => window.location.reload());
  await waitForDefaultWorkspaceReady(60000);
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60000);
  await waitForProviderConfigPolling();

  await selectRegistryProviderModelById(BIGMODEL_E2E_MODEL, {
    includePlainModelFallback: false,
    providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    providerName: "BigModel Coding Plan",
  });
  await browser.execute(() => window.location.reload());
  await waitForDefaultWorkspaceReady(60000);
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60000);
  await waitForProviderConfigPolling();
}

async function setMockScenario(
  scenario: CodingPlanScenario,
  faultMode: CodingPlanFaultMode = "none",
) {
  const baseUrl = getMockBaseUrl();
  const response = await fetch(`${baseUrl}/__e2e/coding-plan/scenario`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      faultMode,
      scenario,
      providerResponsive: faultMode.startsWith("startBalance"),
    }),
  });
  if (!response.ok) {
    throw new Error(`切换 Coding Plan mock scenario Failed: ${response.status}`);
  }
}

async function setResetMockScenario(resetScenario: CodingPlanResetScenario) {
  const response = await fetch(`${getMockBaseUrl()}/__e2e/coding-plan/reset-scenario`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resetScenario }),
  });
  if (!response.ok) {
    throw new Error(`切换 Coding Plan reset mock scenario Failed: ${response.status}`);
  }
}

async function confirmResetUse() {
  const response = await fetch(`${getMockBaseUrl()}/__e2e/coding-plan/reset-confirm-use`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`确认 Coding Plan reset use Failed: ${response.status}`);
  }
}

async function waitForResetOpportunityCount(count: number, rootSelector?: string) {
  await browser.waitUntil(
    async () => {
      const labels = (await browser.execute((root: string | undefined) => {
        const scope = root ? document.querySelector(root) : document;
        return Array.from(
          scope?.querySelectorAll<HTMLElement>('[data-reset-opportunity="true"]') ?? [],
        )
          .filter((element) => {
            const style = window.getComputedStyle(element);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              element.getClientRects().length > 0
            );
          })
          .map((element) => element.innerText.trim());
      }, rootSelector)) as string[];
      return labels.some((label) => label.includes(String(count)));
    },
    {
      timeout: 10000,
      timeoutMsg: `没有展示 ${count} times reset opportunity`,
    },
  );
}

async function clickResetOpportunityBadge(rootSelector?: string) {
  const selector = rootSelector
    ? `${rootSelector} [data-reset-opportunity="true"]`
    : '[data-reset-opportunity="true"]';
  for (const badge of await $$(selector)) {
    if (await badge.isDisplayed()) {
      await badge.click();
      return;
    }
  }
  throw new Error("Could not find clickable reset opportunity badge");
}

async function isContextResetReminderVisible(phase: "initial" | "urgent") {
  return browser.execute((currentPhase) => {
    const element = document.querySelector<HTMLElement>(
      `[data-context-reset-reminder="${currentPhase}"]`,
    );
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  }, phase);
}

async function waitForContextResetReminder(phase: "initial" | "urgent", expectedTexts: string[]) {
  try {
    await browser.waitUntil(
      async () => {
        if (!(await isContextResetReminderVisible(phase))) return false;
        const text = (await browser.execute((currentPhase) => {
          return (
            document.querySelector<HTMLElement>(`[data-context-reset-reminder="${currentPhase}"]`)
              ?.innerText ?? ""
          );
        }, phase)) as string;
        return expectedTexts.some((expected) => text.includes(expected));
      },
      {
        timeout: 15000,
        timeoutMsg: `没有展示 ${phase} reset opportunity reminder`,
      },
    );
  } catch (error) {
    const reminderDiagnostics = await browser.execute(
      (contextTriggerTestId) => ({
        bodyText: document.body?.innerText?.slice(-2500) ?? "",
        contextTriggerVisible: Array.from(
          document.querySelectorAll<HTMLElement>(`[data-testid="${contextTriggerTestId}"]`),
        ).some((element) => element.getClientRects().length > 0),
        opportunityBadges: Array.from(
          document.querySelectorAll<HTMLElement>('[data-reset-opportunity="true"]'),
        ).map((element) => ({
          text: element.innerText,
          visible: element.getClientRects().length > 0,
        })),
        reminders: Array.from(
          document.querySelectorAll<HTMLElement>("[data-context-reset-reminder]"),
        ).map((element) => ({
          phase: element.dataset.contextResetReminder ?? null,
          text: element.innerText,
          visible: element.getClientRects().length > 0,
        })),
      }),
      TID_CHAT_CONTEXT_USAGE_TRIGGER,
    );
    const resetRequests = (await readMockRequests())
      .filter((request) => request.path.includes("/coding-plan/reset/"))
      .map((request) => ({ method: request.method, path: request.path }));
    throw new Error(
      `没有展示 ${phase} reset opportunity reminder\nDiagnostics: ${JSON.stringify(
        { reminderDiagnostics, resetRequests },
        null,
        2,
      )}`,
      { cause: error },
    );
  }
}

async function readQuotaResetOverlayState() {
  return browser.execute(() => {
    const isVisible = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.getClientRects().length > 0
      );
    };
    return {
      dialogVisible: isVisible(document.querySelector('[role="dialog"]')),
      hoverCardVisible: isVisible(document.querySelector('[data-slot="hover-card-content"]')),
    };
  });
}

async function findVisibleButtonByAriaLabels(
  labels: string[],
  required = true,
  rootSelector?: string,
) {
  const selector = rootSelector ? `${rootSelector} button` : "button";
  for (const button of await $$(selector)) {
    if (!(await button.isDisplayed())) continue;
    const ariaLabel = await button.getAttribute("aria-label");
    if (ariaLabel && labels.includes(ariaLabel)) return button;
  }
  if (required) throw new Error(`找不到按钮: ${labels.join("/")}`);
  return undefined;
}

async function readFiveHourUseRequests() {
  return (await readMockRequests()).filter(
    (request) =>
      request.path.endsWith("/api/v1/coding-plan/reset/use") &&
      isRecord(request.body) &&
      request.body.reset_type === "FIVE_HOUR",
  );
}

async function clickDialogFiveHourReset(missingMessage: string) {
  const button = await findVisibleButtonByAriaLabels(
    ["Reset 5-Hour Quota", "重置 5 小时额度"],
    false,
    '[role="dialog"]',
  );
  if (!button) throw new Error(missingMessage);
  await button.click();
}

async function readDialogResetState() {
  return browser.execute(
    (resetLabels: string[], successLabels: string[], weekResetLabels: string[]) => {
      const dialog = document.querySelector('[role="dialog"]');
      const buttons = dialog
        ? Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
        : [];
      const findByLabels = (candidates: string[]) =>
        buttons.find((button) => candidates.includes(button.getAttribute("aria-label") ?? "")) ??
        null;
      const resetButton = findByLabels(resetLabels);
      return {
        resetDisabled: resetButton ? resetButton.disabled : null,
        resetRowText: resetButton?.parentElement?.innerText ?? null,
        successVisible: findByLabels(successLabels) !== null,
        weekResetVisible: findByLabels(weekResetLabels) !== null,
      };
    },
    ["Reset 5-Hour Quota", "重置 5 小时额度"],
    ["Reset Successful", "重置成功"],
    ["Reset Weekly Quota", "重置周额度"],
  );
}

async function waitForDialogResetState(
  predicate: (state: Awaited<ReturnType<typeof readDialogResetState>>) => boolean,
  timeoutMsg: string,
) {
  let lastState: Awaited<ReturnType<typeof readDialogResetState>> | null = null;
  try {
    await browser.waitUntil(
      async () => {
        const state = await readDialogResetState();
        lastState = state;
        return predicate(state);
      },
      { interval: 100, timeout: 10000, timeoutMsg },
    );
  } catch (error) {
    throw new Error(`${timeoutMsg}: ${JSON.stringify(lastState)}`, { cause: error });
  }
}

async function waitForMockRequest(
  predicate: (request: MockRequest) => boolean,
  timeoutMsg: string,
) {
  await browser.waitUntil(async () => (await readMockRequests()).some(predicate), {
    timeout: 10000,
    timeoutMsg,
  });
}

async function waitForLatestMockRequest(
  predicate: (request: MockRequest) => boolean,
  timeoutMsg: string,
): Promise<MockRequest> {
  let match: MockRequest | undefined;
  await browser.waitUntil(
    async () => {
      match = (await readMockRequests()).findLast(predicate);
      return Boolean(match);
    },
    { timeout: 10000, timeoutMsg },
  );
  if (!match) {
    throw new Error(timeoutMsg);
  }
  return match;
}

async function clickVisibleButtonByText(labels: string[]): Promise<void> {
  for (const button of await $$("button")) {
    if ((await button.isDisplayed()) && labels.includes((await button.getText()).trim())) {
      await button.click();
      return;
    }
  }
  throw new Error(`找不到可见按钮: ${labels.join("/")}`);
}

function daysBetweenMonitorTimes(startTime: string, endTime: string): number {
  const start = Date.parse(startTime.replace(" ", "T") + "Z");
  const end = Date.parse(endTime.replace(" ", "T") + "Z");
  return Math.floor((end - start) / 86_400_000);
}

function requireQueryValue(request: MockRequest, key: string): string {
  const value = request.query[key];
  if (!value) {
    throw new Error(`mock request Missing query: ${key}`);
  }
  return value;
}

function requestRangeDays(request: MockRequest): number | null {
  const startTime = request.query.startTime;
  const endTime = request.query.endTime;
  return startTime && endTime ? daysBetweenMonitorTimes(startTime, endTime) : null;
}

async function readMockRequests(): Promise<MockRequest[]> {
  const response = await fetch(`${getMockBaseUrl()}/__e2e/coding-plan/requests`);
  const payload = (await response.json()) as { requests?: MockRequest[] };
  return payload.requests ?? [];
}

function getMockBaseUrl() {
  const baseUrl = process.env.CF_E2E_CODING_PLAN_MOCK_URL?.trim();
  if (!baseUrl) {
    throw new Error("CF_E2E_CODING_PLAN_MOCK_URL 未配置");
  }
  return baseUrl;
}

async function writeSettings(patch: Record<string, unknown>) {
  await mkdir(join(E2E_STORAGE_ROOT, "v2"), { recursive: true });
  const current = await readSettings();
  await writeFile(SETTINGS_FILE, JSON.stringify({ ...current, ...patch }, null, 2), "utf-8");
}

async function writeCredentials(patch: Record<string, unknown>) {
  await mkdir(join(E2E_STORAGE_ROOT, "v2"), { recursive: true });
  const current = await readJsonFile(CREDENTIALS_FILE);
  await writeFile(CREDENTIALS_FILE, JSON.stringify({ ...current, ...patch }, null, 2), "utf-8");
}

async function readSettings(): Promise<{
  providerFamilyConnectionSelections?: {
    bigmodel?: ProviderFamilyConnectionSelection;
    zai?: ProviderFamilyConnectionSelection;
  };
  [key: string]: unknown;
}> {
  try {
    return JSON.parse(await readFile(SETTINGS_FILE, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function assertBodyTextIncludes(values: string[]) {
  try {
    await browser.waitUntil(
      async () => {
        const bodyText = await getBodyText();
        return values.every((value) => bodyText.includes(value));
      },
      {
        timeout: 10000,
        timeoutMsg: `Pages没有出现AllText: ${values.join(" / ")}`,
      },
    );
  } catch (error) {
    throw new Error(
      `Pages没有出现AllText: ${values.join(" / ")}\nCurrentPagesText:\n${(await getBodyText()).slice(0, 2000)}`,
      { cause: error },
    );
  }
}

async function assertBodyTextIncludesAny(values: string[]) {
  try {
    await browser.waitUntil(
      async () => {
        const bodyText = await getBodyText();
        return values.some((value) => bodyText.includes(value));
      },
      {
        timeout: 10000,
        timeoutMsg: `Pages没有出现任OneText: ${values.join(" / ")}`,
      },
    );
  } catch (error) {
    throw new Error(
      `Pages没有出现任OneText: ${values.join(" / ")}\nCurrentPagesText:\n${(await getBodyText()).slice(0, 2000)}`,
      { cause: error },
    );
  }
}

async function assertBodyTextExcludes(values: string[]) {
  const bodyText = await getBodyText();
  for (const value of values) {
    expect(bodyText).not.toContain(value);
  }
}

function getBodyText() {
  return browser.execute(() => document.body?.innerText ?? "");
}

interface MockRequest {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  path: string;
  query: Record<string, string>;
}

type ReminderNavigationWindow = Window & {
  __cfTabStoreE2E: {
    getState(): {
      activeTabId: string | null;
      openSettingsTab(): void;
      activateTab(id: string): void;
    };
  };
};

async function assertContextReminderHiddenInSettings(phase: "initial" | "urgent") {
  const workspaceTabId = await browser.execute(() => {
    const store = (window as unknown as ReminderNavigationWindow).__cfTabStoreE2E;
    const id = store.getState().activeTabId;
    store.getState().openSettingsTab();
    return id;
  });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 10000 });
  await browser.waitUntil(async () => !(await isContextResetReminderVisible(phase)), {
    timeout: 5000,
    timeoutMsg: "Composer reminder leaked through to settings page",
  });
  await browser.execute(() =>
    document
      .querySelector('[data-testid="settings-page"]')!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
  );
  await browser.execute(
    (id) =>
      (window as unknown as ReminderNavigationWindow).__cfTabStoreE2E
        .getState()
        .activateTab(id!),
    workspaceTabId,
  );
  await browser.waitUntil(async () => await isContextResetReminderVisible(phase), {
    timeout: 5000,
    timeoutMsg: "设置页点击误将 Composer 提醒标记为已读",
  });
}

async function readComposerTeamUsageSource(): Promise<string | null> {
  return browser.execute(() => {
    const element = document.querySelector('[data-testid="v4-model-config"]');
    if (!element) return null;
    let fiber = (element as any)[
      Object.keys(element).find((key) => key.startsWith("__reactFiber"))!
    ];
    while (fiber.return) fiber = fiber.return;
    const pending = [fiber.stateNode.current];
    while (pending.length) {
      const node = pending.pop();
      if (Object.hasOwn(node.memoizedProps ?? {}, "codingPlanUsageRemaining"))
        return node.memoizedProps.codingPlanUsageRemaining?.selectedProviderId ?? null;
      if (node.sibling) pending.push(node.sibling);
      if (node.child) pending.push(node.child);
    }
    return null;
  });
}

async function installConnectionBoundaryProbe(
  mode: "logout" | "cas" | "mismatch" | "refresh-failure",
) {
  await browser.execute(async (mode) => {
    const element = document.querySelector('[data-testid="v4-model-config"]')!;
    let fiber = (element as any)[
      Object.keys(element).find((key) => key.startsWith("__reactFiber"))!
    ];
    let services: any;
    let store: any;
    const accessors = new Set<any>();
    while (fiber) {
      const value = fiber.memoizedProps?.value;
      const candidate = value?.settingService ? value : fiber.memoizedProps?.services;
      if (candidate?.settingService) accessors.add(candidate);
      services ??= candidate;
      if (value?.getState && value.getState().setUser) store ??= value;
      fiber = fiber.return;
    }
    if (!services?.settingService) throw new Error("Workspace services not found");
    if (mode === "logout") {
      if (!store) throw new Error("Auth store not found");
      const restorers: (() => void)[] = [];
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      for (const accessor of accessors) {
        const original = accessor.providerSettingsService;
        accessor.providerSettingsService = new Proxy(original, {
          get(target, prop) {
            if (prop !== "refresh") return Reflect.get(target, prop);
            return async (...args: any[]) => {
              await blocked;
              return target.refresh(...args);
            };
          },
        });
        restorers.push(() => {
          accessor.providerSettingsService = original;
        });
      }
      const suppressedRestores: unknown[] = [];
      const pauseAuthRestore = store.subscribe((state: any) => {
        if (state.user) {
          suppressedRestores.push({ userId: state.user.id, authSessionSeq: state.authSessionSeq });
          state.setUser(null);
        }
      });
      (window as any).__logoutBoundaryRelease = async () => {
        pauseAuthRestore();
        restorers.forEach((restore) => restore());
        release();
        await services.oauthService.logoutAll();
        store.getState().setUser(null);
        await services.providerSettingsService.refresh("e2e-signed-out");
      };
      (window as any).__logoutBoundaryAuth = () => ({
        userId: store.getState().user?.id ?? null,
        authSessionSeq: store.getState().authSessionSeq,
      });
      store.getState().setUser(null);
      return;
    }
    const trace: unknown[] = [];
    let restore = () => {};
    const restorers: (() => void)[] = [];
    let injected = false;
    let armed = false;
    let recovered = false;
    let obsoleteStarted = false;
    let rejectObsolete!: (cause: Error) => void;
    const presentationListeners: ((candidate: any) => void)[] = [];
    let releasePresentation!: () => void;
    const synchronized = new Promise<void>((resolve) => {
      releasePresentation = resolve;
    });
    for (const accessor of accessors) {
      const key = mode === "cas" ? "settingService" : "modelSelectionService";
      const service = accessor[key];
      if (mode === "cas") {
        accessor[key] = new Proxy(service, {
          get(target, prop) {
            if (prop !== "update") return Reflect.get(target, prop);
            return async (patch: any, expected: any) => {
              if (armed && !injected && patch.providerFamilyConnectionSelections) {
                injected = true;
                const before = await service.get();
                await service.update(
                  {
                    providerFamilyConnectionSelections: {
                      ...before.providerFamilyConnectionSelections,
                      zai: { kind: "individual-coding-plan" },
                    },
                  },
                  {
                    providerFamilyDomain: before.providerFamilyDomain,
                    providerFamilyConnectionSelections: before.providerFamilyConnectionSelections,
                    providerFamilyDomainUpdatedAt: before.providerFamilyDomainUpdatedAt ?? 0,
                  },
                );
                trace.push({ phase: "concurrent-write", expected });
              }
              return service.update(patch, expected);
            };
          },
        });
      } else {
        accessor[key] = new Proxy(service, {
          get(target, prop) {
            if (mode === "refresh-failure" && prop === "onDidChange")
              return (listener: any) => {
                presentationListeners.push(listener);
                let delivered = false;
                return service.onDidChange((candidate: any) => {
                  if (armed && delivered) return;
                  if (armed) {
                    delivered = true;
                    trace.push({ phase: "target-event", revision: candidate.revision });
                  }
                  listener(candidate);
                });
              };
            if (prop !== "getView") return Reflect.get(target, prop);
            return async (input: any) => {
              if (mode === "refresh-failure" && armed && input) {
                trace.push({ phase: "presentation-failed" });
                throw new Error("E2E presentation read failed");
              }
              if (mode === "refresh-failure" && recovered && input && !obsoleteStarted) {
                obsoleteStarted = true;
                trace.push({ phase: "obsolete-started" });
                return new Promise((_resolve, reject) => {
                  rejectObsolete = reject;
                });
              }
              const view = await service.getView(input);
              if (mode === "refresh-failure") {
                if (recovered && input)
                  trace.push({ phase: "presentation-recovered", revision: view.revision });
                if (armed) trace.push({ phase: "target-synchronized", revision: view.revision });
                return view;
              }
              if (!armed) return view;
              if (!input) {
                trace.push({ phase: "target-synchronized", revision: view.revision });
                releasePresentation();
                return view;
              }
              await synchronized;
              const latest = await service.getView(input);
              trace.push({
                phase: "ready-mismatch",
                revision: latest.revision,
                original: latest.effectiveSelection,
              });
              return {
                ...latest,
                effectiveSelection: {
                  providerId: "e2e-upstream",
                  modelId: "deepseek-v4-flash",
                  options: { reasoningLevel: "disabled" },
                },
              };
            };
          },
        });
      }
      restorers.push(() => {
        accessor[key] = service;
      });
    }
    if (!store) throw new Error("Auth store not found");
    store.getState().setUser({ ...store.getState().user });
    restore = () => {
      releasePresentation();
      restorers.forEach((restore) => restore());
      store.getState().setUser({ ...store.getState().user });
    };
    Object.assign(window, {
      __connectionBoundaryProbe: {
        trace,
        restore,
        recover: () => {
          armed = false;
          recovered = true;
          trace.push({ phase: "fault-recovered" });
        },
        supersede: async () => {
          const candidate = await Array.from(accessors)[0].modelSelectionService.getView();
          presentationListeners.forEach((listener) => listener(candidate));
        },
        rejectObsolete: () => {
          trace.push({ phase: "obsolete-failed" });
          rejectObsolete(new Error("E2E obsolete presentation failed"));
        },
        arm: () => {
          armed = true;
        },
      },
    });
  }, mode);
}
