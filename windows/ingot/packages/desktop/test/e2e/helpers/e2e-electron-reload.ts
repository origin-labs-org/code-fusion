import { execFileSync } from "node:child_process";

import { buildWindowsTaskkillArgs, listE2EProcessTreePids } from "./e2e-process-cleanup.js";
import { reloadE2EElectronServiceBridge } from "./e2e-electron-service-lifecycle.js";

export interface E2EElectronProcessExitOptions {
  afterElectronProcessExit?: () => Promise<void> | void;
  cleanupTimedOutProcessTreePids?: (pids: number[]) => Promise<void> | void;
  collectProcessTreePids?: (rootPids?: number[]) => number[];
  delay?: (ms: number) => Promise<void>;
  forceKillGraceMs?: number;
  isProcessAlive?: (pid: number) => boolean;
  now?: () => number;
  pollIntervalMs?: number;
  reloadElectronServiceBridge?: (browser: WebdriverIO.Browser) => Promise<void>;
  timeoutMs?: number;
}

const DEFAULT_ELECTRON_EXIT_TIMEOUT_MS = 15_000;
const DEFAULT_ELECTRON_EXIT_POLL_INTERVAL_MS = 100;
const DEFAULT_ELECTRON_FORCE_KILL_GRACE_MS = 3_000;

interface PendingElectronExitBarrier {
  consumed: boolean;
  error: unknown;
  wait: () => Promise<void>;
}

const browsersWithDeleteBarrier = new WeakSet<WebdriverIO.Browser>();
const pendingExitBarrierByBrowser = new WeakMap<WebdriverIO.Browser, PendingElectronExitBarrier>();

export async function reloadElectronSessionSafely(
  browser: WebdriverIO.Browser,
  options: E2EElectronProcessExitOptions = {},
) {
  const oldElectronPid = await browser.electron.execute(async (electron) => {
    await electron.session.defaultSession.flushStorageData();
    const appPid = process.pid;
    let quitRequested = false;
    const requestQuit = () => {
      if (quitRequested) return;
      quitRequested = true;
      electron.app.quit();
    };
    const appWindows = electron.BrowserWindow.getAllWindows();
    for (const appWindow of appWindows) {
      appWindow.once("closed", requestQuit);
    }
    if (appWindows.length === 0) {
      setTimeout(requestQuit, 0);
    }
    return appPid;
  });
  const collectProcessTreePids = options.collectProcessTreePids ?? collectCurrentE2EProcessTreePids;
  const oldElectronProcessTreePids = normalizeProcessPids(collectProcessTreePids([oldElectronPid]));
  if (!oldElectronProcessTreePids.includes(oldElectronPid)) {
    throw new Error(
      `Electron reload Old进程树未包含 main pid: pid=${oldElectronPid}, tree=${oldElectronProcessTreePids.join(",") || "empty"}`,
    );
  }

  ensureDeleteSessionExitBarrier(browser);
  const pendingBarrier: PendingElectronExitBarrier = {
    consumed: false,
    error: null,
    wait: () =>
      waitForElectronProcessExit(oldElectronProcessTreePids, {
        ...options,
        collectProcessTreePids,
      }),
  };
  pendingExitBarrierByBrowser.set(browser, pendingBarrier);

  try {
    try {
      await browser.deleteSession({ shutdownDriver: false });
    } catch (error) {
      if (pendingBarrier.error) {
        throw new Error("Electron reload 旧进程退出屏障失败", {
          cause: pendingBarrier.error,
        });
      }
      throw error;
    }
    if (!pendingBarrier.consumed) {
      throw new Error("Electron reload 未经过旧进程退出屏障");
    }
    if (pendingBarrier.error) {
      throw new Error("Electron reload 旧进程退出屏障失败", { cause: pendingBarrier.error });
    }

    await options.afterElectronProcessExit?.();

    const newSessionId = await browser.reloadSession();
    await (options.reloadElectronServiceBridge ?? reloadE2EElectronServiceBridge)(browser);
    return newSessionId;
  } finally {
    pendingExitBarrierByBrowser.delete(browser);
  }
}

export async function reloadElectronSessionPreservingBrowserProfile(
  browser: WebdriverIO.Browser,
  options: E2EElectronProcessExitOptions = {},
): Promise<string> {
  const userDataDir = (await browser.electron.execute((electron) =>
    electron.app.getPath("userData"),
  )) as string;
  const requestedCapabilities = browser.requestedCapabilities as WebdriverIO.Capabilities & {
    "goog:chromeOptions"?: { args?: string[] };
  };
  const chromeOptions = requestedCapabilities["goog:chromeOptions"] ?? {};
  requestedCapabilities["goog:chromeOptions"] = {
    ...chromeOptions,
    args: [
      ...(chromeOptions.args ?? []).filter((arg) => !arg.startsWith("--user-data-dir=")),
      `--user-data-dir=${userDataDir}`,
    ],
  };
  await reloadElectronSessionSafely(browser, options);
  return (await browser.electron.execute((electron) => electron.app.getPath("userData"))) as string;
}

function ensureDeleteSessionExitBarrier(browser: WebdriverIO.Browser) {
  if (browsersWithDeleteBarrier.has(browser)) return;

  const overwriteDeleteSession = async function (
    this: WebdriverIO.Browser,
    originalDeleteSession: (...deleteArgs: unknown[]) => Promise<unknown>,
    ...args: unknown[]
  ) {
    const pendingBarrier = pendingExitBarrierByBrowser.get(this);
    let deleteFailed = false;
    let deleteError: unknown = null;
    let deleteResult: unknown = null;
    try {
      deleteResult = await originalDeleteSession(...args);
    } catch (error) {
      deleteFailed = true;
      deleteError = error;
    }
    if (pendingBarrier) {
      pendingExitBarrierByBrowser.delete(this);
      pendingBarrier.consumed = true;
      try {
        await pendingBarrier.wait();
      } catch (error) {
        pendingBarrier.error = error;
        throw error;
      }
    }
    if (deleteFailed) throw deleteError;
    return deleteResult;
  };
  browser.overwriteCommand("deleteSession" as never, overwriteDeleteSession as never);
  browsersWithDeleteBarrier.add(browser);
}

export async function waitForElectronProcessExit(
  pidOrPids: number | number[],
  options: E2EElectronProcessExitOptions = {},
) {
  const trackedPids = normalizeProcessPids(Array.isArray(pidOrPids) ? pidOrPids : [pidOrPids]);
  const cleanupTimedOutProcessTreePids =
    options.cleanupTimedOutProcessTreePids ??
    ((pids: number[]) => cleanupTimedOutElectronProcessTreePids(pids, options));
  const collectProcessTreePids = options.collectProcessTreePids ?? (() => []);
  const delay = options.delay ?? defaultDelay;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const now = options.now ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_ELECTRON_EXIT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ELECTRON_EXIT_TIMEOUT_MS;
  const forceKillGraceMs = options.forceKillGraceMs ?? DEFAULT_ELECTRON_FORCE_KILL_GRACE_MS;
  const waitOptions = {
    collectProcessTreePids,
    delay,
    isProcessAlive,
    now,
    pollIntervalMs,
  };
  let remainingPids = await waitForProcessTreeExit(trackedPids, timeoutMs, waitOptions);
  if (remainingPids.length === 0) return;

  await cleanupTimedOutProcessTreePids(remainingPids);
  remainingPids = await waitForProcessTreeExit(trackedPids, forceKillGraceMs, waitOptions);
  if (remainingPids.length === 0) return;

  throw new Error(
    `Electron reload Old进程树Exit超时: pids=${remainingPids.join(",")}, timeoutMs=${timeoutMs}`,
  );
}

interface ProcessTreeWaitOptions {
  collectProcessTreePids: () => number[];
  delay: (ms: number) => Promise<void>;
  isProcessAlive: (pid: number) => boolean;
  now: () => number;
  pollIntervalMs: number;
}

async function waitForProcessTreeExit(
  trackedPids: number[],
  timeoutMs: number,
  options: ProcessTreeWaitOptions,
) {
  const startedAt = options.now();
  while (true) {
    const remainingPids = getRemainingProcessTreePids(trackedPids, options);
    if (remainingPids.length === 0 || options.now() - startedAt >= timeoutMs) {
      return remainingPids;
    }
    await options.delay(options.pollIntervalMs);
  }
}

function getRemainingProcessTreePids(
  trackedPids: number[],
  options: Pick<ProcessTreeWaitOptions, "collectProcessTreePids" | "isProcessAlive">,
) {
  return normalizeProcessPids([...trackedPids, ...options.collectProcessTreePids()]).filter(
    options.isProcessAlive,
  );
}

async function cleanupTimedOutElectronProcessTreePids(
  pids: number[],
  options: E2EElectronProcessExitOptions,
) {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", buildWindowsTaskkillArgs(pids), {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
    }
    return;
  }

  signalPosixProcesses(pids, "SIGTERM");
  const forceKillGraceMs = options.forceKillGraceMs ?? DEFAULT_ELECTRON_FORCE_KILL_GRACE_MS;
  const remainingAfterTerm = await waitForProcessTreeExit(pids, forceKillGraceMs, {
    collectProcessTreePids: () => [],
    delay: options.delay ?? defaultDelay,
    isProcessAlive: options.isProcessAlive ?? defaultIsProcessAlive,
    now: options.now ?? Date.now,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_ELECTRON_EXIT_POLL_INTERVAL_MS,
  });
  signalPosixProcesses(remainingAfterTerm, "SIGKILL");
}

function signalPosixProcesses(pids: number[], signal: NodeJS.Signals) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
    }
  }
}

function collectCurrentE2EProcessTreePids(rootPids: number[] = []) {
  const homeDir = process.env.CF_E2E_HOME_DIR?.trim();
  const runId = process.env.CF_E2E_RUN_ID?.trim();
  if (!homeDir || !runId) {
    throw new Error("Electron reload 缺少 CF_E2E_HOME_DIR 或 CF_E2E_RUN_ID");
  }
  return listE2EProcessTreePids({
    currentPid: process.pid,
    homeDir,
    includeChromeDriverAncestors: false,
    rootPids,
    runId,
  });
}

function normalizeProcessPids(pids: number[]) {
  return [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
}

function defaultDelay(ms: number) {
  return new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, Math.max(ms, 0));
  });
}

function defaultIsProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code !== "ESRCH",
    );
  }
}
