import { wrapStartupReporterRequest } from "./startupTelemetryDelivery.js";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import armsRum from "@arms/rum-electron";
import { CF_AGENT_LIFECYCLE_LOG_MARKER } from "@origin-ai/cf-shared/process-diagnostic";
import { CF_ARMS_RUM_ENDPOINT, CF_VERSION, mapCfEnvToArmsRumEnv } from "@origin-ai/cf-shared";
import { ARMS_BROWSER_COLLECTORS, parseArmsViewName } from "../shared/armsRumShared.js";
import { redactArmsEventBatch } from "./armsEventRedaction.js";
import { ensureDesktopDeviceMidSync } from "./desktopDeviceMid.js";
import { ingestArmsApiEventsFromBatch } from "./desktopNetworkTelemetry.js";
import { desktopRuntimeEnv, runtimeApplicationName } from "./desktopRuntimeEnv.js";
import { summarizeLongTaskAttribution } from "./longTaskAttributionSummary.js";
import { logger } from "./logger.js";

function enrichLongTaskAttribution(events: Array<Record<string, unknown>>): void {
  for (const event of events) {
    if (event.event_type !== "longTask") {
      continue;
    }
    const summary = summarizeLongTaskAttribution(event.snapshots, event.duration);
    if (!summary) {
      continue;
    }
    const existingProps =
      event.properties && typeof event.properties === "object"
        ? (event.properties as Record<string, unknown>)
        : {};
    event.properties = { ...existingProps, ...summary };
  }
}

function isCrashReporterEvent(event: Record<string, unknown>): boolean {
  return (
    event.event_type === "exception" && event.type === "crash" && event.source === "crashReporter"
  );
}

function normalizeExecutableName(value: unknown): string {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/\.exe$/i, "")
    : "";
}

function hasProductExecutable(
  event: Record<string, unknown>,
  applicationName: string,
  runtimeExecutableName?: string,
): boolean {
  const expectedNames = new Set(
    [applicationName, runtimeExecutableName].map(normalizeExecutableName).filter(Boolean),
  );
  if (expectedNames.size === 0 || !Array.isArray(event.binary_images)) {
    return false;
  }
  return event.binary_images.some((image) => {
    if (!image || typeof image !== "object") {
      return false;
    }
    return expectedNames.has(normalizeExecutableName((image as Record<string, unknown>).name));
  });
}

type NativeDumpProcessRole = "main" | "renderer" | "utility" | "gpu" | "host" | "agent" | "unknown";

const nativeDumpProcessRoleAliases: Record<string, NativeDumpProcessRole> = {
  main: "main",
  browser: "main",
  main_process: "main",
  renderer: "renderer",
  utility: "utility",
  utility_host: "utility",
  gpu: "gpu",
  host: "host",
  agent: "agent",
};

function readNativeDumpProcessRole(event: Record<string, unknown>): NativeDumpProcessRole {
  const metadata =
    event.meta && typeof event.meta === "object"
      ? (event.meta as Record<string, unknown>)
      : undefined;
  const processType = metadata?.process_type;
  if (typeof processType === "string") {
    return nativeDumpProcessRoleAliases[processType.trim().toLowerCase()] ?? "unknown";
  }
  return "unknown";
}

export function filterAndEnrichNativeCrashEvents(
  events: Array<Record<string, unknown>>,
  applicationName: string,
  runtimeExecutableName?: string,
): Array<Record<string, unknown>> {
  return events.filter((event) => {
    if (!isCrashReporterEvent(event)) {
      return true;
    }
    if (!hasProductExecutable(event, applicationName, runtimeExecutableName)) {
      return false;
    }
    const existingProperties =
      event.properties && typeof event.properties === "object"
        ? (event.properties as Record<string, unknown>)
        : {};
    const nativeDumpProcessRole = readNativeDumpProcessRole(event);
    event.properties = {
      ...existingProperties,
      telemetry_schema_version: "2",
      crash_id:
        typeof existingProperties.crash_id === "string"
          ? existingProperties.crash_id
          : randomUUID(),
      crash_scope:
        nativeDumpProcessRole === "main" ? "app_native_process" : "native_dump_unattributed",
      crash_cause: "native_crash",
      crash_source: "crash_reporter_dump",
      native_dump_process_role: nativeDumpProcessRole,
    };
    return true;
  });
}

const armsRumEnv = mapCfEnvToArmsRumEnv(desktopRuntimeEnv);

const armsDeviceMid = ensureDesktopDeviceMidSync();

const useReporter = armsRum.client.useReporter.bind(armsRum.client);
armsRum.client.useReporter = (reporter) => {
  const request = reporter.request.bind(reporter);
  reporter.request = wrapStartupReporterRequest(request, {
    acknowledged: (eventIds, delivery) =>
      logger.info("[database-startup] telemetry delivery", { eventIds, delivery }),
  });
  useReporter(reporter);
};
export const armsInitPromise = armsRum
  .init({
    enable: CF_ARMS_RUM_ENDPOINT !== "",
    version: CF_VERSION,
    endpoint: CF_ARMS_RUM_ENDPOINT,
    env: armsRumEnv,
    autoInject: true,
    browserCollectors: { ...ARMS_BROWSER_COLLECTORS },
    app: {
      name: runtimeApplicationName,
      version: CF_VERSION,
      env: armsRumEnv,
      type: "electron",
      framework: "react",
    },
    user: {
      name: armsDeviceMid,
    },
    sessionConfig: {
      sampleRate: 1,
    },
    spaMode: false,
    parseViewName: parseArmsViewName,
    collectors: {
      jsError: true,
      consoleError: true,
      crash: true,
      application: true,
      api: true,
      rpc: true,
    },
    tracing: {
      enable: true,
      sample: armsRumEnv === "prod" ? 0.1 : 1,
    },
    beforeReport: (payload: { events?: Array<Record<string, unknown>> }) => {
      const events = filterAndEnrichNativeCrashEvents(
        (payload?.events ?? []).filter(
          (event) =>
            !(
              event.event_type === "exception" &&
              event.type === "error" &&
              event.source === "console.error" &&
              typeof event.message === "string" &&
              event.message.includes(CF_AGENT_LIFECYCLE_LOG_MARKER)
            ),
        ),
        runtimeApplicationName,
        basename(process.execPath),
      );
      payload.events = events;
      ingestArmsApiEventsFromBatch(events);
      enrichLongTaskAttribution(events);
      redactArmsEventBatch(events);
      if (desktopRuntimeEnv === "development") {
        const perfEvents = events.filter(
          (event) => String(event.type ?? "").toLowerCase() === "perf",
        );
        const summary = events
          .map((event) => {
            const eventType = String(event.event_type ?? "?");
            const subType = String(event.type ?? "");
            const name = String(event.name ?? "");
            if (subType === "perf") {
              return `${eventType}:perf`;
            }
            return `${eventType}:${name || subType || "?"}`;
          })
          .join(", ");
        logger.info(
          `[arms] beforeReport batch=${events.length} perf=${perfEvents.length}${summary ? ` [${summary}]` : ""}`,
        );
      }
      return payload;
    },
  })
  .then(() => {
    logger.info(`[arms] electron initialized env=${armsRumEnv} version=${CF_VERSION}`);
  })
  .catch((error) => {
    logger.error("[arms] electron init failed:", error);
    throw error;
  });
