import armsRum from "@arms/rum-electron";
import type { ArmsRumEnv, FinalArmsCustomEventPayload } from "@origin-ai/cf-shared";

import type { CfDataSizeScanResult } from "./cfDataSizeScanner.js";
import {
  readCfDataSizeTelemetryState,
  writeCfDataSizeTelemetryState,
  type CfDataSizeTelemetryState,
} from "./cfDataSizeTelemetryState.js";
import { scanCfDataDirectoryInWorker } from "./cfDataSizeWorkerClient.js";

export type { CfDataSizeTelemetryState } from "./cfDataSizeTelemetryState.js";

export const CF_DATA_SIZE_SCAN_MAX_DURATION_MS = 30_000;
export const CF_DATA_SIZE_SCAN_MAX_FILES = 200_000;
export const CF_DATA_SIZE_DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CF_DATA_SIZE_IDLE_POLL_MS = 5 * 60 * 1000;
export const CF_DATA_SIZE_IDLE_WAIT_FALLBACK_MS = 6 * 60 * 60 * 1000;
export const CF_DATA_SIZE_MINIMUM_IDLE_SECONDS = 5 * 60;
export const CF_DATA_SIZE_STARTUP_MIN_DELAY_MS = 2 * 60 * 1000;
export const CF_DATA_SIZE_STARTUP_JITTER_MAX_MS = 8 * 60 * 1000;
export const CF_DATA_SIZE_DAILY_JITTER_MAX_MS = 60 * 60 * 1000;
export const CF_DATA_SIZE_ABORTED_RETRY_MS = 30 * 60 * 1000;
export const CF_DATA_SIZE_FAILURE_RETRY_MS = 6 * 60 * 60 * 1000;
export const CF_DATA_SIZE_ACTIVITY_POLL_MS = 1_000;

interface CfDataSizeTelemetryTiming {
  abortedRetryMs: number;
  activityPollMs: number;
  dailyIntervalMs: number;
  dailyJitterMaxMs: number;
  failureRetryMs: number;
  idlePollMs: number;
  idleWaitFallbackMs: number;
  minimumIdleSeconds: number;
  startupJitterMaxMs: number;
  startupMinDelayMs: number;
}

const DEFAULT_TIMING: CfDataSizeTelemetryTiming = {
  abortedRetryMs: CF_DATA_SIZE_ABORTED_RETRY_MS,
  activityPollMs: CF_DATA_SIZE_ACTIVITY_POLL_MS,
  dailyIntervalMs: CF_DATA_SIZE_DAILY_INTERVAL_MS,
  dailyJitterMaxMs: CF_DATA_SIZE_DAILY_JITTER_MAX_MS,
  failureRetryMs: CF_DATA_SIZE_FAILURE_RETRY_MS,
  idlePollMs: CF_DATA_SIZE_IDLE_POLL_MS,
  idleWaitFallbackMs: CF_DATA_SIZE_IDLE_WAIT_FALLBACK_MS,
  minimumIdleSeconds: CF_DATA_SIZE_MINIMUM_IDLE_SECONDS,
  startupJitterMaxMs: CF_DATA_SIZE_STARTUP_JITTER_MAX_MS,
  startupMinDelayMs: CF_DATA_SIZE_STARTUP_MIN_DELAY_MS,
};

interface CfDataSizeTelemetryLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

interface CfDataSizeTelemetrySchedulerDependencies {
  deviceMid: string;
  getSystemIdleTimeSeconds: () => number;
  isAppBackground: () => boolean;
  isCfBusy: () => boolean;
  logger: CfDataSizeTelemetryLogger;
  readState: () => Promise<CfDataSizeTelemetryState | null>;
  report: (result: CfDataSizeScanResult) => Promise<void> | void;
  scan: (options: { signal: AbortSignal }) => Promise<CfDataSizeScanResult>;
  timing?: Partial<CfDataSizeTelemetryTiming>;
  writeState: (state: CfDataSizeTelemetryState) => Promise<void>;
}

function normalizeOsCategory(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

function stringifyProperties(
  properties: Record<string, string | number | boolean | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(properties)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

export function buildCfDataSizeArmsPayload(params: {
  context: {
    appVersion: string;
    armsEnv: ArmsRumEnv;
    dataRootKind: "custom" | "default";
    deviceMid: string;
    platform: NodeJS.Platform;
  };
  result: CfDataSizeScanResult;
}): FinalArmsCustomEventPayload {
  const eventName = "perf_resource_cf_data_size";
  return {
    group: "resource",
    name: eventName,
    properties: stringifyProperties({
      app_version: params.context.appVersion,
      arms_env: params.context.armsEnv,
      data_root_kind: params.context.dataRootKind,
      device_mid: params.context.deviceMid,
      directories_scanned: params.result.directoriesScanned,
      event_name: eventName,
      files_scanned: params.result.filesScanned,
      metric_kind: "cf_data_bytes",
      metric_value: params.result.bytes,
      partial_reason: params.result.partialReason,
      platform: normalizeOsCategory(params.context.platform),
      scan_duration_ms: params.result.durationMs,
      scan_error_count: params.result.scanErrorCount,
      scan_status: params.result.status,
      schema_version: 1,
      cf_data_bytes: params.result.bytes,
    }),
    type: "custom",
    value: params.result.bytes,
  };
}

function stableJitterMs(deviceMid: string, bucketAt: number, maxMs: number): number {
  if (maxMs <= 0) {
    return 0;
  }
  const key = `${deviceMid}:${Math.floor(bucketAt / CF_DATA_SIZE_DAILY_INTERVAL_MS)}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % (Math.floor(maxMs) + 1);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function unrefTimer(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void {
  if (typeof timer === "object") {
    timer.unref?.();
  }
}

export function createCfDataSizeTelemetryScheduler(
  dependencies: CfDataSizeTelemetrySchedulerDependencies,
): { start: () => Promise<void>; stop: () => void } {
  const timing = { ...DEFAULT_TIMING, ...dependencies.timing };
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  let activityTimer: ReturnType<typeof setInterval> | null = null;
  let activeAbortController: AbortController | null = null;
  let idleWaitingSince: number | null = null;
  let persistedState: CfDataSizeTelemetryState | null = null;
  let stopped = true;

  function clearScheduledTimer(): void {
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
  }

  function clearActivityTimer(): void {
    if (activityTimer) {
      clearInterval(activityTimer);
      activityTimer = null;
    }
  }

  function schedule(delayMs: number, callback = evaluateDueCollection): void {
    if (stopped) {
      return;
    }
    clearScheduledTimer();
    scheduledTimer = setTimeout(
      () => {
        scheduledTimer = null;
        void callback();
      },
      Math.max(0, delayMs),
    );
    unrefTimer(scheduledTimer);
  }

  function isPreferredIdleWindow(): boolean {
    try {
      return (
        dependencies.getSystemIdleTimeSeconds() >= timing.minimumIdleSeconds &&
        dependencies.isAppBackground()
      );
    } catch {
      return false;
    }
  }

  function collectionEligibilityLost(relaxedIdle: boolean): boolean {
    try {
      return dependencies.isCfBusy() || (!relaxedIdle && !isPreferredIdleWindow());
    } catch {
      return true;
    }
  }

  async function persistSuccess(reportedAt: number): Promise<void> {
    try {
      const nextState = { lastReportedAt: reportedAt };
      await dependencies.writeState(nextState);
      persistedState = nextState;
    } catch (error) {
      dependencies.logger.warn("[cf-data-size] failed to persist report state", error);
    }
  }

  async function reserveReport(reservedAt: number): Promise<CfDataSizeTelemetryState | null> {
    const previousState = persistedState;
    const reservation = { ...previousState, reportReservedAt: reservedAt };
    await dependencies.writeState(reservation);
    persistedState = reservation;
    return previousState;
  }

  async function rollbackReportReservation(
    previousState: CfDataSizeTelemetryState | null,
  ): Promise<void> {
    try {
      const restoredState = previousState ?? {};
      await dependencies.writeState(restoredState);
      persistedState = previousState;
    } catch (error) {
      dependencies.logger.warn("[cf-data-size] failed to roll back report reservation", error);
    }
  }

  async function collectAndReport(relaxedIdle: boolean): Promise<void> {
    const abortController = new AbortController();
    activeAbortController = abortController;
    activityTimer = setInterval(
      () => {
        if (collectionEligibilityLost(relaxedIdle)) {
          abortController.abort();
        }
      },
      Math.max(1, timing.activityPollMs),
    );
    unrefTimer(activityTimer);

    try {
      const result = await dependencies.scan({ signal: abortController.signal });
      if (stopped) {
        return;
      }
      if (abortController.signal.aborted || collectionEligibilityLost(relaxedIdle)) {
        abortController.abort();
        throw new DOMException("CodeFusion data size scan eligibility lost", "AbortError");
      }
      const reportReservedAt = Date.now();
      const previousState = await reserveReport(reportReservedAt);
      if (stopped) {
        await rollbackReportReservation(previousState);
        return;
      }
      if (abortController.signal.aborted || collectionEligibilityLost(relaxedIdle)) {
        await rollbackReportReservation(previousState);
        abortController.abort();
        throw new DOMException("CodeFusion data size report eligibility lost", "AbortError");
      }
      try {
        await dependencies.report(result);
      } catch (error) {
        await rollbackReportReservation(previousState);
        throw error;
      }
      const reportedAt = Date.now();
      await persistSuccess(reportedAt);
      idleWaitingSince = null;
      dependencies.logger.info(
        `[cf-data-size] reported status=${result.status} bytes=${result.bytes}`,
      );
      schedule(
        timing.dailyIntervalMs +
          stableJitterMs(
            dependencies.deviceMid,
            reportedAt + timing.dailyIntervalMs,
            timing.dailyJitterMaxMs,
          ),
      );
    } catch (error) {
      if (stopped) {
        return;
      }
      const aborted = abortController.signal.aborted || isAbortError(error);
      dependencies.logger.warn(
        `[cf-data-size] ${aborted ? "scan aborted" : "scan/report failed"}`,
        error,
      );
      schedule(aborted ? timing.abortedRetryMs : timing.failureRetryMs);
    } finally {
      clearActivityTimer();
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
    }
  }

  async function evaluateDueCollection(): Promise<void> {
    if (stopped || activeAbortController) {
      return;
    }
    const now = Date.now();
    idleWaitingSince ??= now;
    const relaxedIdle = now - idleWaitingSince >= timing.idleWaitFallbackMs;
    if (dependencies.isCfBusy()) {
      schedule(timing.idlePollMs);
      return;
    }
    if (!relaxedIdle && !isPreferredIdleWindow()) {
      schedule(timing.idlePollMs);
      return;
    }
    await collectAndReport(relaxedIdle);
  }

  async function initializeFromPersistedState(): Promise<void> {
    let state: CfDataSizeTelemetryState | null;
    try {
      state = await dependencies.readState();
    } catch (error) {
      dependencies.logger.warn("[cf-data-size] failed to read report state", error);
      schedule(timing.failureRetryMs, initializeFromPersistedState);
      return;
    }
    if (stopped) {
      return;
    }
    persistedState = state;

    const now = Date.now();
    const rateLimitAnchor = Math.max(
      state?.lastReportedAt ?? Number.NEGATIVE_INFINITY,
      state?.reportReservedAt ?? Number.NEGATIVE_INFINITY,
    );
    if (Number.isFinite(rateLimitAnchor)) {
      const baseDueAt = rateLimitAnchor + timing.dailyIntervalMs;
      const dueAt =
        baseDueAt + stableJitterMs(dependencies.deviceMid, baseDueAt, timing.dailyJitterMaxMs);
      if (dueAt > now) {
        schedule(dueAt - now);
        return;
      }
    }
    schedule(
      timing.startupMinDelayMs +
        stableJitterMs(dependencies.deviceMid, now, timing.startupJitterMaxMs),
    );
  }

  return {
    async start() {
      if (!stopped) {
        return;
      }
      stopped = false;
      await initializeFromPersistedState();
    },

    stop() {
      stopped = true;
      clearScheduledTimer();
      clearActivityTimer();
      activeAbortController?.abort();
      activeAbortController = null;
    },
  };
}

let desktopScheduler: ReturnType<typeof createCfDataSizeTelemetryScheduler> | null = null;

export function registerDesktopCfDataSizeTelemetry(options: {
  context: Parameters<typeof buildCfDataSizeArmsPayload>[0]["context"];
  getSystemIdleTimeSeconds: () => number;
  isAppBackground: () => boolean;
  isCfBusy: () => boolean;
  logger: CfDataSizeTelemetryLogger;
  rootPath: string;
  stateFile: string;
}): void {
  stopDesktopCfDataSizeTelemetry();
  desktopScheduler = createCfDataSizeTelemetryScheduler({
    deviceMid: options.context.deviceMid,
    getSystemIdleTimeSeconds: options.getSystemIdleTimeSeconds,
    isAppBackground: options.isAppBackground,
    isCfBusy: options.isCfBusy,
    logger: options.logger,
    readState: () => readCfDataSizeTelemetryState(options.stateFile),
    report: (result) => {
      const payload = buildCfDataSizeArmsPayload({ context: options.context, result });
      armsRum.sendCustom({
        group: payload.group,
        name: payload.name,
        properties: payload.properties,
        type: payload.type,
        value: payload.value,
      });
    },
    scan: ({ signal }) =>
      scanCfDataDirectoryInWorker(
        {
          maxDurationMs: CF_DATA_SIZE_SCAN_MAX_DURATION_MS,
          maxFiles: CF_DATA_SIZE_SCAN_MAX_FILES,
          rootPath: options.rootPath,
        },
        signal,
      ),
    writeState: (state) => writeCfDataSizeTelemetryState(options.stateFile, state),
  });
  void desktopScheduler.start().catch((error) => {
    options.logger.warn("[cf-data-size] scheduler start failed", error);
  });
}

export function stopDesktopCfDataSizeTelemetry(): void {
  desktopScheduler?.stop();
  desktopScheduler = null;
}
