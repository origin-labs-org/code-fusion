import { randomUUID } from "node:crypto";
import {
  CF_PROCESS_DIAGNOSTIC_PREFIX,
  CF_PROCESS_DIAGNOSTIC_NAME_MAX_CHARS,
  CF_PROCESS_DIAGNOSTIC_MESSAGE_MAX_CHARS,
  CF_PROCESS_DIAGNOSTIC_STACK_MAX_CHARS,
  type CfProcessDiagnostic,
} from "@origin-ai/cf-shared/process-diagnostic";

export interface CliProcessErrorBoundaryTarget {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface CliProcessErrorBoundaryOptions {
  onFatal: (reason: unknown) => void;
  target?: CliProcessErrorBoundaryTarget;
  stderr?: {
    write(chunk: string): unknown;
  };
}

interface MonitoredException {
  error: unknown;
  origin: string;
}

export function installCliProcessErrorBoundary(
  options: CliProcessErrorBoundaryOptions,
): () => void {
  const target = options.target ?? (process as unknown as CliProcessErrorBoundaryTarget);
  const stderr = options.stderr ?? process.stderr;
  let monitoredException: MonitoredException | undefined;
  let fatal = false;
  const reportFatal = (
    kind: "uncaughtException" | "unhandledRejection",
    origin: string,
    reason: unknown,
  ) => {
    if (fatal) return;
    fatal = true;
    writeProcessErrorDiagnostic(stderr, kind, origin, reason);
    options.onFatal(reason);
  };

  const onUncaughtExceptionMonitor = (error: unknown, origin: unknown): void => {
    monitoredException = {
      error,
      origin: typeof origin === "string" ? origin : "uncaughtException",
    };
  };
  const onUncaughtException = (error: unknown): void => {
    const matchingMonitor = monitoredException?.error === error ? monitoredException : undefined;
    const origin = matchingMonitor ? matchingMonitor.origin : "uncaughtException";
    monitoredException = undefined;
    if (origin === "unhandledRejection") return;
    reportFatal("uncaughtException", origin, error);
  };
  const onUnhandledRejection = (reason: unknown): void => {
    monitoredException = undefined;
    reportFatal("unhandledRejection", "unhandledRejection", reason);
  };

  target.on("uncaughtExceptionMonitor", onUncaughtExceptionMonitor);
  target.on("uncaughtException", onUncaughtException);
  target.on("unhandledRejection", onUnhandledRejection);

  return () => {
    target.off("uncaughtExceptionMonitor", onUncaughtExceptionMonitor);
    target.off("uncaughtException", onUncaughtException);
    target.off("unhandledRejection", onUnhandledRejection);
    monitoredException = undefined;
  };
}

function writeProcessErrorDiagnostic(
  stderr: { write(chunk: string): unknown },
  kind: "uncaughtException" | "unhandledRejection",
  origin: string,
  reason: unknown,
): void {
  try {
    const detail = formatProcessError(reason).slice(0, CF_PROCESS_DIAGNOSTIC_STACK_MAX_CHARS);
    const diagnostic: CfProcessDiagnostic = {
      version: 1,
      errorId: randomUUID(),
      kind,
      origin: origin === "unhandledRejection" ? origin : "uncaughtException",
      name: (reason instanceof Error ? reason.name || "Error" : "Error").slice(
        0,
        CF_PROCESS_DIAGNOSTIC_NAME_MAX_CHARS,
      ),
      message: (reason instanceof Error ? reason.message : detail).slice(
        0,
        CF_PROCESS_DIAGNOSTIC_MESSAGE_MAX_CHARS,
      ),
      ...(reason instanceof Error && reason.stack ? { stack: detail } : {}),
      occurredAt: Date.now(),
    };
    stderr.write(
      `${CF_PROCESS_DIAGNOSTIC_PREFIX}${JSON.stringify(diagnostic)}\n[cf] process error kind=${kind} origin=${origin}\n${detail}\n`,
    );
  } catch {
  }
}

function formatProcessError(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.stack || `${reason.name}: ${reason.message}`;
  }
  if (typeof reason === "string") {
    return reason;
  }
  try {
    const serialized = JSON.stringify(reason);
    return serialized === undefined ? String(reason) : serialized;
  } catch {
    return String(reason);
  }
}
