import {
  TID_SETTINGS_SECTION_NAV,
  TID_SETTINGS_USAGE_TAB,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
  waitForDefaultWorkspaceReady,
} from "../helpers/desktop-app.js";
import { clearAppUsageE2EFixture } from "../helpers/usage-stats-app-usage-fixture.js";

describe("Usage Stats App Usage E2E", () => {
  after(async () => {
    await clearAppData();
  });

  it("US-AU-02/03/04/05: 聚合、range、Token Activity 与模型图表", async function () {
    this.timeout(120_000);
    await openAppUsage();

    await assertBodyIncludes(["e2e-model-alpha", "e2e-model-beta"]);
    await assertBodyIncludesAny(["Token 活动", "Token Activity"]);
    await assertBodyIncludesAny(["Daily Token Trend", "每日 Token 趋势图"]);
    await assertBodyIncludesAny(["模型用量", "Model Usage"]);
    await assertBodyIncludesAny(["9.5K", "9,510", "9510"]);

    await clickButtonByText(["Last 7 days", "Last 7 Days"]);
    await assertPressedButton(["Last 7 days", "Last 7 Days"]);
    await assertBodyIncludes(["e2e-model-alpha", "e2e-model-beta"]);
    await assertBodyIncludesAny(["2.4K", "2,406", "2406"]);

    await clickButtonByText(["每周", "Weekly"]);
    await assertPressedButton(["每周", "Weekly"]);
    await clickButtonByText(["累计", "Cumulative"]);
    await assertPressedButton(["累计", "Cumulative"]);

    await clickButtonByText(["Last 30 days", "Last 30 Days"]);
    await assertPressedButton(["Last 30 days", "Last 30 Days"]);
    await assertBodyIncludes(["e2e-model-gamma"]);
    await assertBodyIncludesAny(["4.5K", "4,510", "4510"]);
  });

  it("US-AU-01: usage facts 清空后显示确定空态", async function () {
    this.timeout(60_000);
    clearAppUsageE2EFixture(getE2EAppDataPaths().homeDir);
    await clickButtonByText(["刷新", "Refresh"]);
    await browser.waitUntil(
      async () => {
        const body = await $("body").getText();
        return /No usage data yet|还没有可展示的Data/.test(body);
      },
      { timeout: 20_000, timeoutMsg: "清空 usage facts 后没有显示 App Usage 空态" },
    );
    await assertBodyExcludes(["e2e-model-alpha", "e2e-model-gamma"]);
  });
});

async function openAppUsage(): Promise<void> {
  await waitForDefaultWorkspaceReady(60_000);
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 20_000,
    timeoutMsg: "App Usage E2E 无法打开设置页",
  });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "usage"), {
    timeout: 20_000,
    timeoutMsg: "设置页 Usage 分区没有出现",
  });
  await clickTestIdByDom(testId(TID_SETTINGS_USAGE_TAB, "app"), {
    timeout: 20_000,
    timeoutMsg: "App Usage tab 没有出现",
  });
  await browser.waitUntil(
    async () => /Token activity|Token Activity/i.test(await $("body").getText()),
    { timeout: 30_000, timeoutMsg: "App Usage 数据没有完成加载" },
  );
}

async function clickButtonByText(labels: string[]): Promise<void> {
  for (const button of await $$("button")) {
    if (labels.includes((await button.getText()).trim())) {
      await button.click();
      return;
    }
  }
  throw new Error(`找不到按钮: ${labels.join("/")}`);
}

async function assertPressedButton(labels: string[]): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((candidateLabels) => {
        const target = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
          (button) => candidateLabels.includes(button.textContent?.trim() ?? ""),
        );
        return target?.getAttribute("data-state") === "active";
      }, labels),
    { timeout: 10_000, timeoutMsg: `${labels.join("/")} 没有进入 active Status` },
  );
}

async function assertBodyIncludes(values: string[]): Promise<void> {
  await browser.waitUntil(
    async () => {
      const body = await $("body").getText();
      const normalizedBody = body.toLocaleLowerCase();
      return values.every((value) => normalizedBody.includes(value.toLocaleLowerCase()));
    },
    { timeout: 20_000, timeoutMsg: `PagesMissingText: ${values.join(", ")}` },
  );
}

async function assertBodyIncludesAny(values: string[]): Promise<void> {
  await browser.waitUntil(
    async () => {
      const body = await $("body").getText();
      const normalizedBody = body.toLocaleLowerCase();
      return values.some((value) => normalizedBody.includes(value.toLocaleLowerCase()));
    },
    { timeout: 20_000, timeoutMsg: `Pages未出现任OneText: ${values.join(", ")}` },
  );
}

async function assertBodyExcludes(values: string[]): Promise<void> {
  await browser.waitUntil(
    async () => {
      const body = await $("body").getText();
      return values.every((value) => !body.includes(value));
    },
    { timeout: 20_000, timeoutMsg: `Pages仍包含Text: ${values.join(", ")}` },
  );
}
