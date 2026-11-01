import {
  redactTelemetryText,
  type ArmsCustomEventPayload,
  type IPlatformService,
} from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";

export const REACT_ERROR_ARMS_EVENT_NAME = "perf_react_error";

export const REACT_ERROR_ARMS_GROUP = "react_error";

export const REACT_ERROR_STACK_MAX_LEN = 4000;

type ArmsReporter = Pick<IPlatformService, "reportArmsCustomEvent">;

let armsReporter: ArmsReporter | null = null;

export function setReactErrorArmsReporter(reporter: ArmsReporter | null): void {
  armsReporter = reporter;
}

export function clearReactErrorArmsReporterForTest(): void {
  armsReporter = null;
}

function redactStack(value: string): string {
  return redactTelemetryText(value, { maxLength: REACT_ERROR_STACK_MAX_LEN });
}

function buildReactErrorArmsPayload(params: {
  error: Error;
  componentStack: string;
  scope?: string;
}): ArmsCustomEventPayload {
  const errorStack = params.error.stack ? redactStack(params.error.stack) : undefined;
  const componentStack = params.componentStack ? redactStack(params.componentStack) : undefined;
  return {
    name: REACT_ERROR_ARMS_EVENT_NAME,
    group: REACT_ERROR_ARMS_GROUP,
    value: 1,
    properties: {
      error_name: params.error.name,
      error_message: redactTelemetryText(params.error.message),
      error_stack: errorStack || undefined,
      component_stack: componentStack || undefined,
      boundary_scope: params.scope ?? "app",
    },
  };
}

export function reportReactErrorToArms(params: {
  error: Error;
  componentStack: string;
  scope?: string;
}): void {
  if (!armsReporter) {
    return;
  }

  try {
    const payload = buildReactErrorArmsPayload(params);
    void Promise.resolve(armsReporter.reportArmsCustomEvent(payload)).catch((error) => {
      logger.warn("[react-error] ARMS custom event reporting failed", {
        scope: params.scope ?? "app",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    logger.warn("[react-error] ARMS custom event reporting exception", {
      scope: params.scope ?? "app",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
