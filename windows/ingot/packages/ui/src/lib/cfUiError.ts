import type { CfError, CfTaskMeta, TraceId } from "@origin-ai/cf-shared";
import { errorAttributionSchema, type ErrorAttribution } from "@origin-ai/cf-shared/cf-protocol-v4";
import { resolveRequestVerificationBusinessCode } from "@/lib/providerBusinessError.js";

export interface CfUiError extends CfError {
  attribution?: ErrorAttribution;
  detail?: string;
  underlyingErrorMessage?: string;
  underlyingErrorDetail?: string;
}

interface NormalizeCfUiErrorOptions {
  fallbackCode?: string;
  fallbackMessage?: string;
  traceId?: TraceId;
  taskId?: string;
}

const GENERIC_CF_UI_ERROR_MESSAGES = new Set([
  "Internal error",
  "Turn execution failed",
  "Compact failed",
  "Rewind failed",
  "CodeFusion session failed",
]);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function tryParseJsonString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function readValueByPath(record: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = record;
  for (const segment of path) {
    if (!isObjectRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function collectMessageCandidatesFromRecord(record: Record<string, unknown>): string[] {
  const result: string[] = [];
  const push = (value: unknown) => {
    const normalized = normalizeString(value);
    if (!normalized || result.includes(normalized)) {
      return;
    }
    result.push(normalized);
  };

  const messagePaths: Array<readonly string[]> = [
    ["message"],
    ["detail"],
    ["data", "message"],
    ["data", "detail"],
    ["data", "details"],
    ["data", "reason"],
    ["data", "error", "message"],
    ["data", "error", "detail"],
    ["data", "error", "details"],
    ["data", "cf", "error", "message"],
    ["data", "cf", "error", "detail"],
    ["data", "cf", "error", "details"],
  ];
  for (const path of messagePaths) {
    push(readValueByPath(record, path));
  }

  return result;
}

function collectMessageCandidates(error: unknown): string[] {
  const result: string[] = [];
  const push = (value: unknown) => {
    const normalized = normalizeString(value);
    if (!normalized || result.includes(normalized)) {
      return;
    }
    result.push(normalized);
  };

  if (error instanceof Error) {
    push(error.message);
  }

  if (typeof error === "string") {
    const parsed = tryParseJsonString(error);
    if (isObjectRecord(parsed)) {
      for (const candidate of collectMessageCandidatesFromRecord(parsed)) {
        push(candidate);
      }
      if (result.length > 0) {
        return result;
      }
    }
    push(error);
    return result;
  }

  if (isObjectRecord(error)) {
    for (const candidate of collectMessageCandidatesFromRecord(error)) {
      push(candidate);
      const parsed = tryParseJsonString(candidate);
      if (isObjectRecord(parsed)) {
        for (const nestedCandidate of collectMessageCandidatesFromRecord(parsed)) {
          push(nestedCandidate);
        }
      }
    }
    return result;
  }

  push(String(error));
  return result;
}

function readFirstStringFromPaths(
  error: unknown,
  paths: Array<readonly string[]>,
): string | undefined {
  const record = isObjectRecord(error)
    ? error
    : typeof error === "string"
      ? tryParseJsonString(error)
      : null;
  if (!isObjectRecord(record)) {
    return undefined;
  }

  for (const path of paths) {
    const value = normalizeString(readValueByPath(record, path));
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readFirstAttributionFromPaths(error: unknown): ErrorAttribution | undefined {
  const record = isObjectRecord(error)
    ? error
    : typeof error === "string"
      ? tryParseJsonString(error)
      : null;
  if (!isObjectRecord(record)) {
    return undefined;
  }

  const paths: Array<readonly string[]> = [
    ["attribution"],
    ["data", "attribution"],
    ["data", "error", "attribution"],
    ["data", "cf", "error", "attribution"],
  ];
  for (const path of paths) {
    const parsed = errorAttributionSchema.safeParse(readValueByPath(record, path));
    if (parsed.success) {
      return parsed.data;
    }
  }
  return undefined;
}

export function normalizeCfUiError(
  error: unknown,
  options: NormalizeCfUiErrorOptions = {},
): CfUiError {
  const candidates = collectMessageCandidates(error);
  const primaryMessage =
    candidates.find((candidate) => !GENERIC_CF_UI_ERROR_MESSAGES.has(candidate)) ??
    candidates[0] ??
    options.fallbackMessage ??
    "Internal error";
  const detailMessage = candidates.find(
    (candidate) => candidate !== primaryMessage && !GENERIC_CF_UI_ERROR_MESSAGES.has(candidate),
  );
  const codeFromError = readFirstStringFromPaths(error, [
    ["code"],
    ["providerCode"],
    ["data", "code"],
    ["data", "error", "code"],
    ["data", "cf", "error", "code"],
    ["data", "cf", "error", "context", "providerCode"],
    ["data", "error", "context", "providerCode"],
    ["context", "providerCode"],
  ]);
  const detailFromError = readFirstStringFromPaths(error, [
    ["detail"],
    ["data", "detail"],
    ["data", "error", "detail"],
    ["data", "cf", "error", "detail"],
  ]);
  const underlyingErrorMessage = readFirstStringFromPaths(error, [
    ["underlyingErrorMessage"],
    ["data", "underlyingErrorMessage"],
    ["data", "error", "underlyingErrorMessage"],
    ["data", "cf", "error", "underlyingErrorMessage"],
  ]);
  const underlyingErrorDetail = readFirstStringFromPaths(error, [
    ["underlyingErrorDetail"],
    ["data", "underlyingErrorDetail"],
    ["data", "error", "underlyingErrorDetail"],
    ["data", "cf", "error", "underlyingErrorDetail"],
  ]);
  const providerCodeFromDetail = detailFromError?.match(/provider_code=([0-9]+)/)?.[1];
  const verificationRejectedCode = resolveRequestVerificationBusinessCode(
    codeFromError ?? providerCodeFromDetail,
    primaryMessage,
  );
  const traceIdFromError = readFirstStringFromPaths(error, [
    ["traceId"],
    ["data", "traceId"],
    ["data", "error", "traceId"],
    ["data", "cf", "error", "traceId"],
  ]) as TraceId | undefined;
  const taskIdFromError = readFirstStringFromPaths(error, [
    ["taskId"],
    ["data", "taskId"],
    ["data", "error", "taskId"],
    ["data", "cf", "error", "taskId"],
  ]);
  const attribution = readFirstAttributionFromPaths(error);

  return {
    code:
      verificationRejectedCode ??
      providerCodeFromDetail ??
      codeFromError ??
      options.fallbackCode ??
      "UNKNOWN",
    message: primaryMessage,
    detail: detailMessage,
    ...(underlyingErrorMessage ? { underlyingErrorMessage } : {}),
    ...(underlyingErrorDetail ? { underlyingErrorDetail } : {}),
    traceId: options.traceId ?? traceIdFromError,
    taskId: options.taskId ?? taskIdFromError,
    ...(attribution ? { attribution } : {}),
  };
}

export function normalizeRestoredTaskFailureError(meta: CfTaskMeta): CfUiError | null {
  if (!meta.lastError) {
    return null;
  }

  return normalizeCfUiError(meta.lastError, {
    fallbackCode: meta.lastError.code,
    traceId: meta.lastError.traceId ?? meta.traceId,
    taskId: meta.lastError.taskId ?? meta.taskId,
  });
}
