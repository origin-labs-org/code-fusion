import type { LogContext, Logger } from "@origin-ai/cf-contracts";

interface AiSdkWarningLoggerOptions {
  model?: unknown;
  provider?: unknown;
  warnings?: unknown;
}

type AiSdkWarningLogger = (options: AiSdkWarningLoggerOptions) => void;

type AiSdkWarningGlobal = typeof globalThis & {
  AI_SDK_LOG_WARNINGS?: false | AiSdkWarningLogger;
};

export function installCfProtocolAiSdkWarningLogger(logger: Logger): void {
  (globalThis as AiSdkWarningGlobal).AI_SDK_LOG_WARNINGS = (
    options: AiSdkWarningLoggerOptions,
  ) => {
    try {
      const warnings = Array.isArray(options.warnings) ? options.warnings : [];
      logger.warn("AI SDK model warning", {
        event: "model.sdk.warning",
        module: "bootstrap.cf_protocol",
        status: "completed",
        model: stringValue(options.model),
        provider: stringValue(options.provider),
        warningCount: warnings.length,
        warnings: warnings.map(summarizeWarning),
      });
    } catch {
    }
  };
}

function summarizeWarning(warning: unknown): LogContext {
  if (!warning || typeof warning !== "object") {
    return { value: stringValue(warning) };
  }
  const record = warning as Record<string, unknown>;
  return {
    type: stringValue(record.type),
    feature: stringValue(record.feature),
    message: stringValue(record.message),
    details: stringValue(record.details),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
