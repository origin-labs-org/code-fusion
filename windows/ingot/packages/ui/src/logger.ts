import { formatLogPrefix } from "@origin-ai/cf-shared";

export type LogLevel = "debug" | "info" | "warn" | "error";

type DesktopLogLevel = Exclude<LogLevel, "debug">;

type DesktopLogBridgeWindow = Window & {
  cf?: {
    log?: (level: DesktopLogLevel, args: unknown[]) => void;
  };
};

function isRendererProductionBuild(): boolean {
  const viteProduction =
    ((import.meta as ImportMeta & { env?: { readonly PROD?: boolean } }).env ?? {}).PROD === true;
  return (
    viteProduction || (typeof process !== "undefined" && process.env.NODE_ENV === "production")
  );
}

function isRendererLoggingDisabled(): boolean {
  return (
    (
      globalThis as typeof globalThis & {
        __CF_RENDERER_DISABLE_LOGGING__?: boolean;
      }
    ).__CF_RENDERER_DISABLE_LOGGING__ === true
  );
}

const consoleFns: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.debug,
  info: console.log,
  warn: console.warn,
  error: console.error,
};

export function isLoggerLevelEnabled(_level: LogLevel): boolean {
  return !isRendererProductionBuild() && !isRendererLoggingDisabled();
}

function log(level: LogLevel, ...args: unknown[]) {
  if (!isLoggerLevelEnabled(level)) {
    return;
  }
  consoleFns[level](formatLogPrefix("ui"), ...args);
  if (level !== "debug" && typeof window !== "undefined") {
    (window as DesktopLogBridgeWindow).cf?.log?.(level, args);
  }
}

function lifecycleLog(level: DesktopLogLevel, ...args: unknown[]) {
  if (isRendererLoggingDisabled()) {
    return;
  }
  if (isRendererProductionBuild()) {
    if (typeof window !== "undefined") {
      (window as DesktopLogBridgeWindow).cf?.log?.(level, args);
    }
    return;
  }
  log(level, ...args);
}

export const logger = {
  debug: (...args: unknown[]) => log("debug", ...args),
  info: (...args: unknown[]) => log("info", ...args),
  warn: (...args: unknown[]) => log("warn", ...args),
  error: (...args: unknown[]) => log("error", ...args),
  lifecycle: {
    info: (...args: unknown[]) => lifecycleLog("info", ...args),
    warn: (...args: unknown[]) => lifecycleLog("warn", ...args),
    error: (...args: unknown[]) => lifecycleLog("error", ...args),
  },
  
  trace: (traceId: string, level: LogLevel, ...args: unknown[]) => {
    log(level, `[trace:${traceId}]`, ...args);
  },
};

export function logMemoryDiagnostics(line: string): void {
  if (isRendererLoggingDisabled()) {
    return;
  }
  if (typeof window !== "undefined") {
    const bridge = (window as DesktopLogBridgeWindow).cf?.log;
    if (bridge) {
      bridge("info", [line]);
      return;
    }
  }
  if (!isRendererProductionBuild()) {
    consoleFns.info(formatLogPrefix("ui"), line);
  }
}
