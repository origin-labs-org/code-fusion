import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TID_LOGIN_API_KEY_SKIP_BUTTON,
  TID_LOGIN_USE_API_KEY_BUTTON,
  TID_TASK_ITEM,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  waitForDefaultWorkspaceReady,
  waitForTestIdByDom,
} from "./helpers/desktop-app.js";
import {
  PROVIDER_READINESS_HISTORY_SESSION_ID,
  PROVIDER_READINESS_HISTORY_TITLE,
} from "./helpers/provider-readiness-history-fixture.js";

const AGENT_METRIC_PROBE_SKIPPED_MARKER =
  "agent_metric_probe action=skipped reason=main_process_external_probe_disabled";
const AGENT_METRIC_PROBE_SPAWN_MARKER = "agent_metric_probe action=spawn";

const POWERSHELL_MARKER = "powershell";
const windowsDescribe = process.platform === "win32" ? describe : describe.skip;

windowsDescribe("Windows Agent metric collection main process gate", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("PERF-RES-01: Resource sampling logs only record skipped after real Agent registration, without starting external probes", async function () {
    this.timeout(90000);

    await waitForTestIdByDom(TID_LOGIN_USE_API_KEY_BUTTON, {
      timeout: 30000,
      timeoutMsg: "API Key configuration entry was not displayed after empty auth/provider cold start",
    });
    await clickTestIdByDom(TID_LOGIN_USE_API_KEY_BUTTON);
    await clickTestIdByDom(TID_LOGIN_API_KEY_SKIP_BUTTON, {
      timeout: 15000,
      timeoutMsg: "API Key login page has no available skip-for-now option",
    });
    await waitForDefaultWorkspaceReady(30000);
    await waitForSeededHistory();

    const runtimeLogDir = process.env.CF_E2E_RUNTIME_LOG_DIR?.trim();
    if (!runtimeLogDir) {
      throw new Error("当前 E2E worker 没有配置 desktop runtime log 目录");
    }

    let desktopLogs = "";
    await browser.waitUntil(
      async () => {
        desktopLogs = await readDesktopRuntimeLogs(runtimeLogDir);
        return desktopLogs.includes(AGENT_METRIC_PROBE_SKIPPED_MARKER);
      },
      {
        timeout: 45000,
        interval: 250,
        timeoutMsg:
          "Main log still did not record skipped audit disabling external probes after real Agent registration spanned resource sampling period",
      },
    );

    await browser.pause(500);
    desktopLogs = await readDesktopRuntimeLogs(runtimeLogDir);
    expect(desktopLogs).toContain(AGENT_METRIC_PROBE_SKIPPED_MARKER);
    expect(desktopLogs).not.toContain(AGENT_METRIC_PROBE_SPAWN_MARKER);
    expect(desktopLogs.toLowerCase()).not.toContain(POWERSHELL_MARKER);
  });
});

async function waitForSeededHistory(): Promise<void> {
  const itemTestId = testId(TID_TASK_ITEM, PROVIDER_READINESS_HISTORY_SESSION_ID);
  await waitForTestIdByDom(itemTestId, {
    timeout: 30000,
    timeoutMsg: "Preset history rows did not appear in sidebar when provider is not ready",
  });
  const title = await browser.execute((targetTestId) => {
    return document
      .querySelector<HTMLElement>(`[data-testid="${targetTestId}"]`)
      ?.innerText.replace(/\s+/g, " ")
      .trim();
  }, itemTestId);
  expect(title).toContain(PROVIDER_READINESS_HISTORY_TITLE);
}

async function readDesktopRuntimeLogs(runtimeLogDir: string): Promise<string> {
  try {
    const entries = await readdir(runtimeLogDir, { withFileTypes: true });
    const logFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
      .map((entry) => entry.name)
      .sort();
    const contents = await Promise.all(
      logFiles.map((fileName) => readFile(join(runtimeLogDir, fileName), "utf8")),
    );
    return contents.join("\n");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
