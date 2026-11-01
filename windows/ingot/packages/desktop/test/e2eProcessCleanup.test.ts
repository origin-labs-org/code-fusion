import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  buildE2ERunIdArg,
  buildWindowsTaskkillArgs,
  collectProcessTreeByRootPids,
  collectE2EProcessTreePids,
  collectWindowsE2EProcessTreePids,
  createWindowsE2EHomeMarkerArg,
  listE2EProcessTreePids,
  listSystemProcesses,
} from "./e2e/helpers/e2e-process-cleanup.js";

const CURRENT_HOME = "C:\\e2e\\shards\\current";
const CURRENT_HOME_MARKER = createWindowsE2EHomeMarkerArg(CURRENT_HOME);

function toProcessJson(rows: Array<{ command: unknown; parentPid: unknown; pid: unknown }>) {
  return JSON.stringify(
    rows.map((row) => ({
      CommandLine: row.command,
      ParentProcessId: row.parentPid,
      ProcessId: row.pid,
    })),
  );
}

describe("desktop e2e process cleanup", () => {
  it("combines one worker process tree into a single taskkill invocation", () => {
    expect(buildWindowsTaskkillArgs([12, 11, 12, 10])).toEqual([
      "/PID",
      "12",
      "/PID",
      "11",
      "/PID",
      "10",
      "/T",
      "/F",
    ]);
  });

  it("passes both run and HOME identity markers through Electron appArgs", () => {
    const wdioSource = readFileSync(new URL("../wdio.conf.ts", import.meta.url), "utf8");

    expect(CURRENT_HOME_MARKER).toBe(`--cf-e2e-home=${CURRENT_HOME}`);
    expect(wdioSource).toMatch(
      /appArgs:\s*\[[\s\S]*?buildE2ERunIdArg\(E2E_RUN_ID\)[\s\S]*?createWindowsE2EHomeMarkerArg\(E2E_HOME_DIR\)[\s\S]*?\]/u,
    );
  });

  it("stages and launches an immutable app output under the current run cache", () => {
    const wdioSource = readFileSync(new URL("../wdio.conf.ts", import.meta.url), "utf8");

    expect(wdioSource).toMatch(/const E2E_APP_OUTPUT_DIR = resolve\(E2E_RUN_CACHE_DIR, "app"\)/u);
    expect(wdioSource).toMatch(
      /await stageE2EAppOutput\(DESKTOP_BUILD_OUTPUT_DIR, E2E_APP_OUTPUT_DIR\)/u,
    );
    expect(wdioSource).toMatch(/`--app=\$\{E2E_APP_ENTRY_POINT\}`/u);
    expect(wdioSource).not.toMatch(/`--app=\$\{DESKTOP_BUILD_ENTRY_POINT\}`/u);
  });

  it("lets ChromeDriver close the renderer before Electron app.quit", () => {
    const wdioSource = readFileSync(new URL("../wdio.conf.ts", import.meta.url), "utf8");
    const mainSource = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");

    expect(wdioSource).toMatch(/appWindow\.once\("closed", requestQuitAfterDriverClose\)/u);
    expect(wdioSource).toMatch(/async after[\s\S]*?await armCurrentElectronAppQuit\("after"\)/u);
    expect(wdioSource).not.toMatch(/async after[\s\S]*?await quitCurrentElectronApp\("after"\)/u);
    expect(mainSource).toMatch(/win\.once\("closed", exitAfterLastWindowClosed\)/u);
    expect(mainSource).toMatch(
      /const exitAfterLastWindowClosed[\s\S]*?exitPreparedApp\("all-windows-closed-after-preparation"\)/u,
    );
    expect(mainSource).toMatch(
      /process\.env\.CF_E2E_RUN_ID\?\.trim\(\)[\s\S]*?spawn\("taskkill"[\s\S]*?spawn\("kill", \["-9", String\(process\.pid\)\]/u,
    );
  });

  it("waits for each window Host once and keeps update install on the strict policy", () => {
    const mainSource = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");

    expect(mainSource).toMatch(
      /async function prepareAppQuit[\s\S]*?remoteSessionManager\.disposeAllAndWaitForAppShutdown\(reason\)/u,
    );
    expect(mainSource).toMatch(
      /async function prepareAppQuit[\s\S]*?stopRemoteUsageArmsPeriodicSampling\(\)[\s\S]*?remoteSessionManager\.disposeAllAndWaitForAppShutdown\(reason\)/u,
    );
    expect(mainSource).toMatch(
      /async function prepareAppQuit[\s\S]*?stopDesktopResourceTelemetry\(\{ flushPendingWindows: true \}\)/u,
    );
    expect(mainSource).toMatch(
      /prepareAppQuit\("auto-update quitAndInstall", "update-install"\)[\s\S]*?prepareWindowsProcessesForUpdateInstall\(\)/u,
    );
    expect(mainSource).toMatch(
      /async function prepareAppQuit[\s\S]*?selectAppShutdownPolicy[\s\S]*?if \(hasPreparedAppQuit\)[\s\S]*?if \(appQuitPreparationInFlight\)/u,
    );
    expect(mainSource).toMatch(
      /createRemoteWorkspaceSessionManager\(\{[\s\S]*?windowHostProcessMap[\s\S]*?const hostProcesses = \[[\s\S]*?windowHostProcessMap\.values\(\)[\s\S]*?disposeHostProcessAndWait\([\s\S]*?activeAppShutdownPolicy\.forceKillDelayMs[\s\S]*?activeAppShutdownPolicy\.waitTimeoutMs/u,
    );
    expect(mainSource).not.toMatch(/resolveRemoteHostShutdownPolicy/u);
    expect(mainSource).toMatch(
      /const cronSchedulerToDispose = cronScheduler[\s\S]*?appQuitPreparationInFlight = Promise\.all\(\[[\s\S]*?cronSchedulerToDispose\?\.dispose\(\)[\s\S]*?remoteSessionManager\.disposeAllAndWaitForAppShutdown/u,
    );
    expect(mainSource).not.toMatch(
      /appQuitPreparationInFlight = Promise\.all\(\[[\s\S]*?desktopWindowSizePersistence\?\.flush\(\)/u,
    );
    expect(mainSource).toMatch(
      /appQuitPreparationInFlight = Promise\.all\(\[[\s\S]*?appTelemetryCore\.flushPendingReports\(\{ timeoutMs: 2_000 \}\)/u,
    );
    expect(mainSource).not.toMatch(/browserGuestManager\.whenRecoveryIdle\(\)/u);
    expect(mainSource).toMatch(
      /async function prepareAppQuit[\s\S]*?browserScreenshotSurfaceCoordinator\.dispose\(\)/u,
    );
  });

  it("forces the Host to exit after its parent IPC disconnects", () => {
    const hostSource = readFileSync(new URL("../src/host/index.ts", import.meta.url), "utf8");

    expect(hostSource).toMatch(
      /process\.once\("disconnect"[\s\S]*?disposeHostResources\("disconnect"\)\.finally\(\(\) => process\.exit\(1\)\)/u,
    );
  });

  it("Host waits for the remote stdio close handshake", () => {
    const hostSource = readFileSync(new URL("../src/host/index.ts", import.meta.url), "utf8");

    expect(hostSource).toMatch(
      /async function disposeHostRemoteConnection[\s\S]*?connection\.dispose\(\)[\s\S]*?name: "remote-registry-dispose"[\s\S]*?timeoutMs: 6_000/u,
    );
    expect(hostSource).toContain('name: "source-server-manager-dispose"');
  });

  it("collects only the current run root and its child process tree", () => {
    const sharedEntryPoint = "/repo/packages/desktop/out/main/index.js";
    const processes = [
      {
        command: `Electron --app=${sharedEntryPoint} --no-sandbox ${buildE2ERunIdArg("run-a")}`,
        pid: 10,
        ppid: 1,
      },
      { command: "node host-process", pid: 11, ppid: 10 },
      { command: "node cf-agent", pid: 12, ppid: 11 },
      {
        command: `Electron --app=${sharedEntryPoint} --no-sandbox ${buildE2ERunIdArg("run-b")}`,
        pid: 20,
        ppid: 1,
      },
      { command: "node other-host-process", pid: 21, ppid: 20 },
    ];

    expect(
      collectE2EProcessTreePids(processes, {
        currentPid: 999,
        homeDir: "/tmp/cf-e2e-run-a",
        runId: "run-a",
      }),
    ).toEqual([12, 11, 10]);
  });

  it("collects an explicitly anchored Electron main tree without command markers", () => {
    const processes = [
      { command: "Electron", pid: 10, ppid: 1 },
      { command: "Electron Helper (Renderer)", pid: 11, ppid: 10 },
      { command: "node host-process", pid: 12, ppid: 10 },
      { command: "node cf-agent", pid: 13, ppid: 12 },
    ];

    expect(
      collectE2EProcessTreePids(processes, {
        currentPid: 999,
        homeDir: "/tmp/cf-e2e-run-a",
        rootPids: [10],
        runId: "run-a",
      }),
    ).toEqual([13, 12, 11, 10]);
  });

  it("recovers markerless ChromeDriver and Electron ancestors from a marked renderer", () => {
    const currentHome = "/tmp/cf-e2e-run-a";
    const processes = [
      { command: "node wdio.conf.ts", pid: 9, ppid: 1 },
      { command: "chromedriver --port=55089", pid: 10, ppid: 9 },
      { command: "CodeFusion E2E", pid: 11, ppid: 10 },
      {
        command: `Electron Helper (Renderer) --user-data-dir=/repo/.e2e-cache/run-a/chromium-profiles/0-51 --config=${currentHome}/.cf/config.json`,
        pid: 12,
        ppid: 11,
      },
      { command: "node host-process", pid: 13, ppid: 11 },
      {
        command: "Electron Helper --user-data-dir=/repo/.e2e-cache/run-b/chromium-profiles/0-4",
        pid: 22,
        ppid: 21,
      },
      { command: "CodeFusion E2E", pid: 21, ppid: 20 },
    ];

    expect(
      collectE2EProcessTreePids(processes, {
        currentPid: 9,
        homeDir: currentHome,
        runId: "run-a",
      }),
    ).toEqual([13, 12, 11, 10]);
  });

  it("keeps ChromeDriver out of the per-session reload exit barrier", () => {
    const currentHome = "/tmp/cf-e2e-run-a";
    const processes = [
      { command: "node wdio.conf.ts", pid: 9, ppid: 1 },
      { command: "chromedriver --port=55089", pid: 10, ppid: 9 },
      { command: "CodeFusion E2E", pid: 11, ppid: 10 },
      {
        command: `Electron Helper (Renderer) --config=${currentHome}/.cf/config.json`,
        pid: 12,
        ppid: 11,
      },
      { command: "node host-process", pid: 13, ppid: 11 },
    ];

    expect(
      collectE2EProcessTreePids(processes, {
        currentPid: 9,
        homeDir: currentHome,
        includeChromeDriverAncestors: false,
        runId: "run-a",
      }),
    ).toEqual([13, 12, 11]);
  });

  it("recovers the complete renamed Electron tree from only its run-owned Chromium profile", () => {
    const chromiumProfileRootDir = "/repo/.e2e-cache/run-a/chromium-profiles";
    const processes = [
      { command: "node wdio.conf.ts", pid: 9, ppid: 1 },
      { command: "chromedriver --port=55089", pid: 10, ppid: 9 },
      { command: "CodeFusion E2E", pid: 11, ppid: 10 },
      {
        command: `Electron Helper --type=gpu-process --user-data-dir=${chromiumProfileRootDir}/0-2`,
        pid: 12,
        ppid: 11,
      },
      { command: "Electron Helper", pid: 13, ppid: 11 },
      { command: "node cf-agent", pid: 14, ppid: 13 },
      {
        command: "chrome_crashpad_handler --database=/tmp/cf-e2e-run-a/.cf/crash",
        pid: 15,
        ppid: 1,
      },
      { command: "chromedriver --port=55090", pid: 20, ppid: 9 },
      { command: "CodeFusion E2E", pid: 21, ppid: 20 },
      {
        command:
          "Electron Helper --user-data-dir=/repo/.e2e-cache/run-a-other/chromium-profiles/0-2",
        pid: 22,
        ppid: 21,
      },
      {
        command: `Electron Helper --user-data-dir=${chromiumProfileRootDir}-other/0-2`,
        pid: 30,
        ppid: 1,
      },
    ];
    const identity = {
      chromiumProfileRootDir,
      currentPid: 9,
      homeDir: "/tmp/cf-e2e-run-a",
      runId: "run-a",
    };

    expect(collectE2EProcessTreePids(processes, identity)).toEqual([15, 14, 13, 12, 11, 10]);
    expect(
      collectE2EProcessTreePids(processes, {
        ...identity,
        includeChromeDriverAncestors: false,
      }),
    ).toEqual([15, 14, 13, 12, 11]);
  });

  it("matches quoted Windows Chromium profile paths without matching neighboring directories", () => {
    const processes = [
      {
        command: 'electron.exe --user-data-dir="C:\\E2E Cache\\run-a\\chromium-profiles\\0-2"',
        pid: 10,
        ppid: 1,
      },
      {
        command:
          'electron.exe --user-data-dir="C:\\E2E Cache\\run-a\\chromium-profiles-other\\0-2"',
        pid: 20,
        ppid: 1,
      },
    ];

    expect(
      collectE2EProcessTreePids(processes, {
        chromiumProfileRootDir: "c:/e2e cache/run-a/chromium-profiles/",
        currentPid: 999,
        homeDir: "",
      }),
    ).toEqual([10]);
  });

  it("uses the entire current run profile root for worker cleanup", () => {
    const wdioSource = readFileSync(new URL("../wdio.conf.ts", import.meta.url), "utf8");

    expect(wdioSource).toMatch(
      /listE2EProcessTreePids\(\{\s*chromiumProfileRootDir: E2E_CHROMIUM_USER_DATA_ROOT_DIR,/u,
    );
  });

  it("does not climb from an E2E driver into an unrelated terminal process tree", () => {
    const processes = [
      { command: "Terminal.app", pid: 5, ppid: 1 },
      { command: "zsh", pid: 6, ppid: 5 },
      { command: "node old-wdio-worker.js", pid: 7, ppid: 6 },
      { command: "chromedriver --port=55089", pid: 10, ppid: 7 },
      { command: "CodeFusion E2E", pid: 11, ppid: 10 },
      {
        command:
          "Electron Helper --user-data-dir=/repo/.e2e-cache/run-a/chromium-profiles/0-51 --config=/tmp/cf-e2e-run-a/.cf/config.json",
        pid: 12,
        ppid: 11,
      },
    ];

    expect(
      collectE2EProcessTreePids(processes, {
        currentPid: 99,
        homeDir: "/tmp/cf-e2e-run-a",
        runId: "run-a",
      }),
    ).toEqual([12, 11, 10]);
  });

  it("uses the shared run identity scanner for POSIX process trees", () => {
    const runCommand = vi.fn(() =>
      [
        `10 1 Electron ${buildE2ERunIdArg("run-a")}`,
        "11 10 node host-process",
        "12 11 node cf-agent",
      ].join("\n"),
    );

    expect(
      listE2EProcessTreePids(
        { currentPid: 999, homeDir: "/tmp/cf-e2e-run-a", runId: "run-a" },
        { platform: "linux", runCommand },
      ),
    ).toEqual([12, 11, 10]);
    expect(runCommand).toHaveBeenCalledWith("ps", ["-axo", "pid=,ppid=,command="]);
  });

  it("lists and scopes a read-only system process snapshot by explicit roots", async () => {
    const runCommand = vi.fn(async () =>
      [
        "10 1 CodeFusion E2E",
        "11 10 cf-host-local-1",
        "12 11 cf-cli",
        "13 12 cf-browser-use-mcp",
        "20 1 unrelated",
      ].join("\n"),
    );

    const processes = await listSystemProcesses({
      platform: "linux",
      runCommand,
    });

    expect(collectProcessTreeByRootPids(processes, [10])).toEqual([
      { command: "CodeFusion E2E", pid: 10, ppid: 1 },
      { command: "cf-host-local-1", pid: 11, ppid: 10 },
      { command: "cf-cli", pid: 12, ppid: 11 },
      { command: "cf-browser-use-mcp", pid: 13, ppid: 12 },
    ]);
  });

  it("uses the shared PowerShell fallback for Windows process trees", () => {
    const runCommand = vi
      .fn<(command: string, args: string[]) => string>()
      .mockImplementationOnce(() => {
        throw new Error("Windows PowerShell unavailable");
      })
      .mockReturnValueOnce(
        toProcessJson([
          {
            command: `electron.exe ${CURRENT_HOME_MARKER}`,
            parentPid: 1,
            pid: 101,
          },
          { command: "node.exe host-process", parentPid: 101, pid: 102 },
        ]),
      );

    expect(
      listE2EProcessTreePids(
        { currentPid: 999, homeDir: CURRENT_HOME },
        { platform: "win32", runCommand },
      ),
    ).toEqual([102, 101]);
    expect(runCommand.mock.calls.map(([command]) => command)).toEqual(["powershell.exe", "pwsh"]);
  });

  it("does not treat shared app title or build paths as cleanup identity", () => {
    const sharedEntryPoint = "/repo/packages/desktop/out/main/index.js";
    const sharedMainDir = "/repo/packages/desktop/out/main";
    const processes = [
      {
        command: `Electron "CodeFusion E2E" --app=${sharedEntryPoint} --inspect=${sharedMainDir}`,
        pid: 10,
        ppid: 1,
      },
      { command: "node host-process", pid: 11, ppid: 10 },
    ];

    expect(
      collectE2EProcessTreePids(processes, {
        currentPid: 999,
        homeDir: "/tmp/cf-e2e-run-a",
        runId: "run-a",
      }),
    ).toEqual([]);
  });

  it("matches the current HOME with Windows and slash-normalized paths", () => {
    const output = toProcessJson([
      {
        command: `electron.exe ${CURRENT_HOME_MARKER}`,
        parentPid: 1,
        pid: 101,
      },
      {
        command: "node.exe --config=C:/e2e/shards/current/.cf/cli/config.json",
        parentPid: 101,
        pid: 102,
      },
    ]);

    expect(
      collectWindowsE2EProcessTreePids(output, {
        currentPid: 999,
        homeDir: CURRENT_HOME,
      }),
    ).toEqual([102, 101]);
  });

  it("does not select another shard with the same app entry point or a HOME prefix", () => {
    const sharedApp = "C:\\repo\\packages\\desktop\\out\\main\\index.js";
    const output = toProcessJson([
      {
        command: `electron.exe --app=${sharedApp} --name="CodeFusion E2E" ${CURRENT_HOME_MARKER}`,
        parentPid: 1,
        pid: 201,
      },
      {
        command: `electron.exe --app=${sharedApp} --name="CodeFusion E2E" ${createWindowsE2EHomeMarkerArg("C:\\e2e\\shards\\other")}`,
        parentPid: 1,
        pid: 202,
      },
      {
        command: `electron.exe --app=${sharedApp} --name="CodeFusion E2E" ${createWindowsE2EHomeMarkerArg(`${CURRENT_HOME}-copy`)}`,
        parentPid: 1,
        pid: 203,
      },
    ]);

    expect(
      collectWindowsE2EProcessTreePids(output, {
        currentPid: 999,
        homeDir: CURRENT_HOME,
      }),
    ).toEqual([201]);
  });

  it("excludes the current process, its ancestors, and WDIO controllers", () => {
    const processes = [
      { command: `node parent ${CURRENT_HOME_MARKER}`, pid: 400, ppid: 1 },
      { command: `node runner ${CURRENT_HOME_MARKER}`, pid: 401, ppid: 400 },
      { command: `node @wdio/cli ${CURRENT_HOME_MARKER}`, pid: 402, ppid: 1 },
      {
        command: `node wdio.conf.ts ${CURRENT_HOME_MARKER}`,
        pid: 403,
        ppid: 1,
      },
      { command: "node controller-child", pid: 404, ppid: 402 },
    ];

    expect(
      collectE2EProcessTreePids(processes, {
        currentPid: 401,
        homeDir: CURRENT_HOME,
      }),
    ).toEqual([]);
  });

  it("matches run id arguments with command boundaries", () => {
    const processes = [
      {
        command: `Electron ${buildE2ERunIdArg("run-1-extra")}`,
        pid: 10,
        ppid: 1,
      },
      { command: `Electron ${buildE2ERunIdArg("run-1")}`, pid: 20, ppid: 1 },
    ];

    expect(
      collectE2EProcessTreePids(processes, {
        currentPid: 999,
        homeDir: "/tmp/cf-e2e-run-1",
        runId: "run-1",
      }),
    ).toEqual([20]);
  });

  it.each(["", "not-json", "null", "{}"])(
    "treats malformed or empty Windows process JSON as no matches: %j",
    (output) => {
      expect(
        collectWindowsE2EProcessTreePids(output, {
          currentPid: 999,
          homeDir: CURRENT_HOME,
        }),
      ).toEqual([]);
    },
  );
});
