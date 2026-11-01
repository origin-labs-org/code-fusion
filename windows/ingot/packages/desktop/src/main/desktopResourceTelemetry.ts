import armsRum from "@arms/rum-electron";
import {
  bytesToKb,
  createMemorySampleWriteGate,
  formatMemorySampleLine,
  mapCfEnvToArmsRumEnv,
  memoryUsageToSampleFields,
  type MemorySample,
  type MemorySampleWriteGate,
  type ProcessResourceRole,
  type ProcessResourceRuntimeSurface,
  PROCESS_RESOURCE_EVENT_NAMES,
  cfToolExecResourceSchema,
} from "@origin-ai/cf-shared";
import { BrowserWindow } from "electron";
import os from "node:os";
import { getSharedFinalArmsCustomEventE2EController } from "./desktopArmsCustomEvent.js";
import { desktopRuntimeEnv } from "./desktopRuntimeEnv.js";
import { mainMemoryDiagnosticsRegistry } from "./mainMemoryDiagnostics.js";
import { addAppResourceTotals, type AppResourceTotals } from "./processResourceAppTotals.js";
import { PROCESS_RESOURCE_SAMPLE_SOURCES } from "./processResourceSampleSourceRegistry.js";
import {
  flushPendingProcessResourceSampleSources,
  resetProcessResourceSampleSources,
  runProcessResourceDeviceSampleSources,
  runProcessResourceSampleSources,
} from "./processResourceSampleSources.js";
import { ProcessResourceSystemWindowAggregator } from "./processResourceSystemWindowAggregator.js";
import {
  buildSystemWindowEventProperties,
  PERF_SYSTEM_WINDOW_EVENT_NAME,
} from "./processResourceSystemWindowEvent.js";
import {
  ProcessResourceWindowAggregator,
  type ProcessResourceHardware,
  type ProcessRoleSample,
} from "./processResourceWindowAggregator.js";
import {
  buildProcessWindowEventProperties,
  normalizeOsCategory,
  PERF_PROCESS_WINDOW_EVENT_NAME,
} from "./processResourceWindowEvent.js";
import { listRegisteredHostAgentProcessIds } from "./resourceManagerWindow.js";

export const RESOURCE_SAMPLE_INTERVAL_MS = 10_000;

function resolveDefaultReportIntervalMs(): number {
  if (desktopRuntimeEnv === "development") {
    return 60_000;
  }
  if (process.env.CF_ENV === "test" && process.env.CF_E2E_RUN_ID?.trim()) {
    return 60_000;
  }
  return 300_000;
}

export const RESOURCE_REPORT_INTERVAL_MS = resolveDefaultReportIntervalMs();

export const MEMORY_LOG_SAMPLE_EVERY_N_TICKS = 6;

export type ResourceUsageScene = "foreground" | "background";

interface ResourceLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

interface ResourceGlobalContext {
  deviceMid: string;
  platform: NodeJS.Platform;
  appVersion: string;
  armsEnv: ReturnType<typeof mapCfEnvToArmsRumEnv>;
}

let globalContext: ResourceGlobalContext | null = null;
let desktopHardware: ProcessResourceHardware | null = null;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let reportTimer: ReturnType<typeof setInterval> | null = null;
let agentMetricProbeDisabledAuditLogged = false;
let memoryLogTick = 0;
let memorySampleWriteGate: MemorySampleWriteGate = createMemorySampleWriteGate();

let readTelemetrySelfClockMs: () => number = () => performance.now();

const processResourceWindows = new ProcessResourceWindowAggregator();
const processResourceSystemWindow = new ProcessResourceSystemWindowAggregator();

const MAX_RECENT_TOOL_EXEC_COMPLETIONS = 1_024;
const recentToolExecCompletions = new Set<string>();

function resolveDesktopHardware(platform: NodeJS.Platform): ProcessResourceHardware {
  return {
    platform,
    arch: process.arch,
    logicalCpuCount: os.cpus().length,
    totalMemoryGb: Math.round(os.totalmem() / 1024 ** 3),
  };
}

function stringifyProperties(
  properties: Record<string, string | number | boolean | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) {
      continue;
    }
    result[key] = String(value);
  }
  return result;
}

function reportResourceCustom(
  name: string,
  
  metricValue: number,
  properties: Record<string, string | number | boolean | undefined>,
): void {
  if (!globalContext) {
    return;
  }

  const payload = {
    name,
    type: "custom" as const,
    group: "resource",
    value: metricValue,
    properties: stringifyProperties(properties),
  };

  const e2eController = getSharedFinalArmsCustomEventE2EController();
  e2eController?.record(payload);
  if (e2eController?.shouldSuppress(name)) {
    return;
  }

  try {
    armsRum.sendCustom(payload);
  } catch (error) {
    console.warn("[resource] sendCustom failed:", name, error);
  }
}

export function resolveResourceUsageScene(): ResourceUsageScene {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  if (windows.length === 0) {
    return "background";
  }

  const anyFocused = windows.some((win) => win.isFocused());
  const anyVisible = windows.some((win) => win.isVisible() && !win.isMinimized());
  return anyFocused && anyVisible ? "foreground" : "background";
}

export function ingestToolExecResource(
  raw: unknown,
  runtimeSurface: ProcessResourceRuntimeSurface,
): void {
  if (!globalContext) return;
  const parsed = cfToolExecResourceSchema.safeParse(raw);
  if (!parsed.success) return;
  const sample = parsed.data;
  if (sample.completionToken) {
    if (recentToolExecCompletions.has(sample.completionToken)) return;
    recentToolExecCompletions.add(sample.completionToken);
    if (recentToolExecCompletions.size > MAX_RECENT_TOOL_EXEC_COMPLETIONS) {
      const oldest = recentToolExecCompletions.values().next().value;
      if (oldest !== undefined) recentToolExecCompletions.delete(oldest);
    }
  }
  reportResourceCustom(PROCESS_RESOURCE_EVENT_NAMES.toolExecResource, sample.durationMs, {
    platform: normalizeOsCategory(sample.platform),
    app_version: globalContext.appVersion,
    arms_env: globalContext.armsEnv,
    device_mid: globalContext.deviceMid,
    runtime_surface: runtimeSurface,
    tool_name: sample.toolName,
    exit_kind: sample.exitKind,
    sample_count: sample.sampleCount,
    cli_rss_kb: sample.cliRssKb,
    system_free_memory_kb: sample.systemFreeMemoryKb,
    ...(sample.platform === "win32"
      ? {}
      : {
          tree_rss_kb_peak: sample.treeRssKbPeak ?? 0,
          tree_cpu_time_ms: sample.treeCpuTimeMs ?? 0,
        }),
  });
}

function auditDisabledAgentMetricProbe(logger: ResourceLogger | undefined): void {
  if (
    agentMetricProbeDisabledAuditLogged ||
    process.platform !== "win32" ||
    process.env.CF_ENV !== "test" ||
    !process.env.CF_E2E_RUNTIME_LOG_DIR?.trim()
  ) {
    return;
  }

  const agentCount = listRegisteredHostAgentProcessIds().length;
  if (agentCount === 0) {
    return;
  }

  agentMetricProbeDisabledAuditLogged = true;
  logger?.info(
    `[resource] agent_metric_probe action=skipped reason=main_process_external_probe_disabled agent_count=${agentCount}`,
  );
}

function readMainMemoryUsage(): NodeJS.MemoryUsage | null {
  try {
    return process.memoryUsage();
  } catch {
    return null;
  }
}

function logMemorySample(
  logger: ResourceLogger | undefined,
  memoryUsage: NodeJS.MemoryUsage,
  samples: readonly ProcessRoleSample[],
): void {
  if (!logger) {
    return;
  }
  try {
    const counters = mainMemoryDiagnosticsRegistry.collect();
    for (const sample of samples) {
      counters[`ws.${sample.role}`] = sample.rssKbTotal;
    }
    const sample: MemorySample = {
      role: "main",
      ...memoryUsageToSampleFields(memoryUsage),
      counters,
    };
    const reason = memorySampleWriteGate.evaluate(sample, Date.now());
    if (reason) {
      logger.info(formatMemorySampleLine(sample, reason));
    }
  } catch {
  }
}

function takeSample(logger?: ResourceLogger): void {
  processResourceWindows.recordScene(resolveResourceUsageScene());

  const now = Date.now();
  const samples: ProcessRoleSample[] = [];
  
  const heapUsedKbByRole = new Map<ProcessResourceRole, number>();
  let appProcessTotals: AppResourceTotals | null = null;
  const onError = (sourceId: string, error: unknown): void =>
    logger?.warn(`[resource] sample source ${sourceId} failed:`, error);
  runProcessResourceSampleSources(PROCESS_RESOURCE_SAMPLE_SOURCES, {
    now,
    addRoleSample: (sample) => samples.push(sample),
    addRoleHeapSample: (role, heapUsedKb) => heapUsedKbByRole.set(role, heapUsedKb),
    addAppProcessTotals: (totals) => {
      appProcessTotals = appProcessTotals ? addAppResourceTotals(appProcessTotals, totals) : totals;
    },
    onError,
  });

  memoryLogTick += 1;
  const mainMemoryUsage =
    memoryLogTick % MEMORY_LOG_SAMPLE_EVERY_N_TICKS === 0 ? readMainMemoryUsage() : null;
  if (mainMemoryUsage) {
    heapUsedKbByRole.set("main", bytesToKb(mainMemoryUsage.heapUsed));
  }

  for (const sample of samples) {
    const heapUsedKb = heapUsedKbByRole.get(sample.role);
    processResourceWindows.add(heapUsedKb === undefined ? sample : { ...sample, heapUsedKb });
  }

  if (mainMemoryUsage) {
    logMemorySample(logger, mainMemoryUsage, samples);
  }

  runProcessResourceDeviceSampleSources(PROCESS_RESOURCE_SAMPLE_SOURCES, {
    now,
    appProcessTotals,
    addDeviceSample: (sample) => processResourceSystemWindow.add(sample),
    onError,
  });

  auditDisabledAgentMetricProbe(logger);
}

function measureTelemetrySelfMs(run: () => void): void {
  const startedAt = readTelemetrySelfClockMs();
  try {
    run();
  } finally {
    processResourceSystemWindow.addTelemetrySelfMs(readTelemetrySelfClockMs() - startedAt);
  }
}

function reportProcessResourceWindows(): void {
  if (!globalContext || !desktopHardware) {
    processResourceWindows.clear();
    return;
  }
  const context = {
    deviceMid: globalContext.deviceMid,
    appVersion: globalContext.appVersion,
    armsEnv: globalContext.armsEnv,
    desktopHardware,
  };
  for (const report of processResourceWindows.drain()) {
    reportResourceCustom(
      PERF_PROCESS_WINDOW_EVENT_NAME,
      report.cpuPercentMean,
      buildProcessWindowEventProperties(report, context),
    );
  }
}

function resolveAppUptimeMinutes(): number {
  const uptimeSeconds = process.uptime();
  return Number.isFinite(uptimeSeconds) ? Math.max(0, Math.round(uptimeSeconds / 60)) : 0;
}

function reportSystemResourceWindow(backgroundRatio: number): void {
  if (!globalContext || !desktopHardware) {
    processResourceSystemWindow.clear();
    return;
  }
  const report = processResourceSystemWindow.drain({
    backgroundRatio,
    appUptimeMinutes: resolveAppUptimeMinutes(),
  });
  if (!report) {
    return;
  }
  reportResourceCustom(
    PERF_SYSTEM_WINDOW_EVENT_NAME,
    report.appCpuPercentMean,
    buildSystemWindowEventProperties(report, {
      deviceMid: globalContext.deviceMid,
      appVersion: globalContext.appVersion,
      armsEnv: globalContext.armsEnv,
      desktopHardware,
    }),
  );
}

function flushPendingSourceReadings(logger?: ResourceLogger): void {
  flushPendingProcessResourceSampleSources(PROCESS_RESOURCE_SAMPLE_SOURCES, {
    now: Date.now(),
    addRoleSample: (sample) => processResourceWindows.add(sample),
    addRoleHeapSample: () => {},
    addAppProcessTotals: () => {},
    onError: (sourceId, error) =>
      logger?.warn(`[resource] sample source ${sourceId} flush failed:`, error),
  });
}

function drainAllResourceWindows(logger?: ResourceLogger): void {
  flushPendingSourceReadings(logger);
  const backgroundRatio = processResourceWindows.backgroundRatio;
  reportProcessResourceWindows();
  reportSystemResourceWindow(backgroundRatio);
}

function flushResourceReports(logger: ResourceLogger): void {
  drainAllResourceWindows(logger);
  logger.info("[resource] perf_process_window + perf_system_window flushed");
}

export function configureDesktopResourceTelemetry(context: ResourceGlobalContext): void {
  recentToolExecCompletions.clear();
  processResourceWindows.clear();
  processResourceSystemWindow.clear();
  globalContext = context;
  desktopHardware = resolveDesktopHardware(context.platform);

  armsRum.setConfig("properties", {
    device_mid: context.deviceMid,
    platform: normalizeOsCategory(context.platform),
    app_version: context.appVersion,
    arms_env: context.armsEnv,
  });
}

export function registerDesktopResourceTelemetry(
  logger: ResourceLogger,
  
  options?: { reportIntervalMs?: number; readSelfClockMs?: () => number },
): void {
  stopDesktopResourceTelemetry();
  agentMetricProbeDisabledAuditLogged = false;
  memoryLogTick = 0;
  memorySampleWriteGate = createMemorySampleWriteGate();
  resetProcessResourceSampleSources(PROCESS_RESOURCE_SAMPLE_SOURCES);
  processResourceSystemWindow.clear();
  readTelemetrySelfClockMs = options?.readSelfClockMs ?? (() => performance.now());

  const reportIntervalMs = options?.reportIntervalMs ?? RESOURCE_REPORT_INTERVAL_MS;

  sampleTimer = setInterval(() => {
    measureTelemetrySelfMs(() => {
      try {
        takeSample(logger);
      } catch (error) {
        logger.warn("[resource] sample failed:", error);
      }
    });
  }, RESOURCE_SAMPLE_INTERVAL_MS);

  reportTimer = setInterval(() => {
    measureTelemetrySelfMs(() => {
      try {
        flushResourceReports(logger);
      } catch (error) {
        logger.warn("[resource] report failed:", error);
      }
    });
  }, reportIntervalMs);

  sampleTimer.unref?.();
  reportTimer.unref?.();

  logger.info(
    `[resource] sampling started interval=${RESOURCE_SAMPLE_INTERVAL_MS}ms report=${reportIntervalMs}ms`,
  );
}

export function stopDesktopResourceTelemetry(options?: {
  
  flushPendingWindows?: boolean;
}): void {
  recentToolExecCompletions.clear();
  if (sampleTimer) {
    clearInterval(sampleTimer);
    sampleTimer = null;
  }
  if (reportTimer) {
    clearInterval(reportTimer);
    reportTimer = null;
  }
  if (options?.flushPendingWindows) {
    drainAllResourceWindows();
  } else {
    processResourceWindows.clear();
    processResourceSystemWindow.clear();
  }
}
