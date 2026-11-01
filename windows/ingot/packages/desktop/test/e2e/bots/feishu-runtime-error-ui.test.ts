import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  getE2EAppDataPaths,
  seedSettings,
  waitForDefaultWorkspaceReady,
} from "../helpers/desktop-app.js";
import { createFeishuConfig, readBotSyntheticFixture } from "./helpers/bots-service-harness.js";

const BOT_NAME = "Feishu Runtime Error E2E";
const BOTS_DIALOG_TEXT = "机器人";

describe("Feishu runtime error Desktop UI", () => {
  before(async () => {
    const fixture = await readBotSyntheticFixture("feishu-runtime-error-ui.json");
    expect(fixture).toMatchObject({
      caseId: "BOT-E2E-CF-01",
      classification: "synthetic",
      timing: "controlled-process",
    });
    expect(fixture.syntheticReason.length).toBeGreaterThan(20);

    const { appDataDir } = getE2EAppDataPaths();
    const config = createFeishuConfig("feishu", "feishu-runtime-error-e2e");
    config.bots[0] = {
      ...config.bots[0]!,
      name: BOT_NAME,
      enabled: false,
      credentialRef: "bot:feishu-runtime-error-e2e:credential",
      providerUserId: "ou_bound_runtime_error_e2e",
    };
    await mkdir(appDataDir, { recursive: true });
    await writeFile(join(appDataDir, "bot-config.v3.json"), `${JSON.stringify(config, null, 2)}\n`);
    await seedSettings({ locale: "zh-CN", localePreference: "zh-CN" });
  });

  it("BOT-E2E-CF-01 keeps the binding visible when the Feishu connection fails", async () => {
    await browser.refresh();
    await waitForDefaultWorkspaceReady(60_000);
    await openBotsDialog();
    await browser.waitUntil(() => botsDialogIncludes(BOT_NAME), {
      timeout: 20_000,
      timeoutMsg: "机器人弹窗没有加载隔离的 Feishu E2E 配置",
    });

    const enabled = await browser.execute(
      (dialogText, botName) => {
        const dialog = Array.from(document.querySelectorAll<HTMLElement>("[role=dialog]")).find(
          (candidate) =>
            candidate.textContent?.includes(dialogText) && candidate.textContent.includes(botName),
        );
        const toggle = dialog?.querySelector<HTMLElement>("[role=switch]");
        if (!toggle) return false;
        toggle.click();
        return true;
      },
      BOTS_DIALOG_TEXT,
      BOT_NAME,
    );
    expect(enabled).toBe(true);

    await waitForBoundConnectionError();

    const persisted = JSON.parse(
      await readFile(join(getE2EAppDataPaths().appDataDir, "bot-config.v3.json"), "utf8"),
    );
    expect(persisted.version).toBe(3);
    expect(persisted.bots[0]).toMatchObject({
      enabled: true,
      providerUserId: "ou_bound_runtime_error_e2e",
    });

    const dialogText = await readBotsDialogText();
    expect(dialogText).toContain("飞书连接失败");
    expect(dialogText).toContain("连接中断");
    expect(dialogText).toContain("Persistent connection limit may have been reached or Feishu service is busy");
    expect(dialogText).toContain("若持续失败，可绑定新的机器人");
    expect(dialogText).toContain("解绑");
    expect(dialogText).not.toContain("已连通");

    const statusControlGap = await browser.execute(() => {
      const status = Array.from(document.querySelectorAll("span")).find(
        (element) => element.textContent?.trim() === "连接中断",
      );
      const unbind = Array.from(document.querySelectorAll("button")).find((element) =>
        element.textContent?.includes("解绑"),
      );
      if (!status || !unbind) return null;
      return unbind.getBoundingClientRect().left - status.getBoundingClientRect().right;
    });
    expect(statusControlGap).not.toBeNull();
    expect(statusControlGap ?? -1).toBeGreaterThanOrEqual(0);

    const artifactDir = process.env.CF_E2E_ARTIFACT_DIR?.trim();
    if (artifactDir) {
      await browser.saveScreenshot(join(artifactDir, "BOT-E2E-CF-01-feishu-runtime-error.png"));
    }
  });
});

async function openBotsDialog() {
  const remoteControl = await $('button[aria-label="移动端远程控制"]');
  await remoteControl.waitForClickable({ timeout: 20_000 });
  await remoteControl.click();
  const openBots = await $('[data-testid="web-remote-control-open-bots"]');
  await openBots.waitForClickable({ timeout: 20_000 });
  await openBots.click();
}

async function waitForBoundConnectionError() {
  await browser.waitUntil(
    () => botsDialogIncludes("连接中断"),
    {
      interval: 500,
      timeout: 20_000,
      timeoutMsg: "Feishu runtime error was not projected as bound connection interrupted state",
    },
  );
}

async function botsDialogIncludes(expected: string) {
  return (await readBotsDialogText()).includes(expected);
}

async function readBotsDialogText() {
  return browser.execute(
    (dialogText, botName) => {
      const dialog = Array.from(document.querySelectorAll<HTMLElement>("[role=dialog]")).find(
        (candidate) =>
          candidate.textContent?.includes(dialogText) && candidate.textContent.includes(botName),
      );
      return dialog?.textContent ?? "";
    },
    BOTS_DIALOG_TEXT,
    BOT_NAME,
  ) as Promise<string>;
}
