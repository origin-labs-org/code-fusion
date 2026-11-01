function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeErrorCode(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return undefined;
}

function getErrorCandidate(error: unknown): unknown {
  if (!isRecord(error) || !("error" in error) || !isRecord(error.error)) {
    return error;
  }

  if ("message" in error.error || "code" in error.error) {
    return error.error;
  }

  return error;
}

export interface NormalizedUnknownError {
  message: string;
  code?: string;
}

export const CF_FILE_LOCK_TIMEOUT_ERROR_CODE = "CF_FILE_LOCK_TIMEOUT" as const;

export function stringifyUnknownValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
  }

  return String(value);
}

export function normalizeUnknownError(error: unknown): NormalizedUnknownError {
  const candidate = getErrorCandidate(error);
  if (candidate instanceof Error) {
    const errorWithCode = candidate as Error & { code?: unknown };
    return {
      message: candidate.message || candidate.name || String(candidate),
      code: normalizeErrorCode(errorWithCode.code),
    };
  }

  if (isRecord(candidate)) {
    const code = "code" in candidate ? normalizeErrorCode(candidate.code) : undefined;
    const message =
      "message" in candidate
        ? stringifyUnknownValue(candidate.message)
        : stringifyUnknownValue(candidate);

    return {
      message:
        message !== "undefined" && message.length > 0 ? message : stringifyUnknownValue(candidate),
      code,
    };
  }

  return {
    message: stringifyUnknownValue(candidate),
  };
}

export function isCfFileLockTimeoutError(error: unknown): boolean {
  return normalizeUnknownError(error).code === CF_FILE_LOCK_TIMEOUT_ERROR_CODE;
}

export const NON_RETRYABLE_WORKSPACE_PREPARE_ERROR_PATTERNS = [
  "binary 未找到",
  "未正确安装",
  "binary not found",
  "not installed",
  "initialize 前进程已退出",
  "initialize 超时",
  "进程启动失败",
  "optional dependency was not installed",
  "Cannot find package '@openai/codex-",
  "Missing optional dependency @openai/codex-",
  "Missing Codex runtime files",
  "Gemini API key is missing or not configured",
  "Please fix the configuration file(s)",
  "Expected property name or '}' in JSON",
  "已暂停自动重试",
] as const;

export const NON_MCP_FALLBACK_EXTRA_ERROR_PATTERNS = ["session/new 超时"] as const;

const OPENCODE_RUNTIME_CRASH_ERROR_PATTERNS = [
  "opencode runtime 崩溃",
  "opencode runtime crashed",
  "bun has crashed",
  "segmentation fault",
  "panic(main thread)",
  "code=3221226505",
] as const;

export function isNonRetryableWorkspacePrepareError(errorMessage: string): boolean {
  const normalizedMessage = errorMessage.toLowerCase();
  return NON_RETRYABLE_WORKSPACE_PREPARE_ERROR_PATTERNS.some((pattern) =>
    normalizedMessage.includes(pattern.toLowerCase()),
  );
}

export function isOpenCodeRuntimeCrashError(errorMessage: string): boolean {
  const normalizedMessage = errorMessage.toLowerCase();
  return OPENCODE_RUNTIME_CRASH_ERROR_PATTERNS.some((pattern) =>
    normalizedMessage.includes(pattern.toLowerCase()),
  );
}
