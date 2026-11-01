import { resolve } from "node:path";

const DEFAULT_E2E_WEBDRIVER_REQUEST_TIMEOUT_MS = 30_000;
const MAX_E2E_WEBDRIVER_REQUEST_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_E2E_WEBDRIVER_REQUEST_RETRY_COUNT = 0;
const MAX_E2E_WEBDRIVER_REQUEST_RETRY_COUNT = 3;
const BG26_SPEC_MARKER = "conversation-session-background-subagent-rate-limit.test.ts";
const MODEL_SWITCH_RESTORE_REPRO_SPEC_MARKER =
  "conversation-session-model-switch-restore-repro.test.ts";
const BG25_SPEC_MARKER = "conversation-session-subagent-respond-to-coordinator.test.ts";
const I55_SPEC_MARKER = "conversation-session-thought-level-session-isolation.test.ts";
const REPLAY_MODEL_STREAM_IDLE_TIMEOUT_MS = 10_000;
const SSE_STALL_DIAGNOSTIC_SPEC_MARKER = "conversation-session-sse-stall-diagnostic.test.ts";
const SSE_STALL_DIAGNOSTIC_IDLE_TIMEOUT_MS = 1_000;
const REPLAY_PROXY_ISOLATED_SPEC_MARKERS = [BG25_SPEC_MARKER, I55_SPEC_MARKER] as const;
const MODEL_RETRY_DISABLED_SPEC_MARKERS = [
  BG26_SPEC_MARKER,
  MODEL_SWITCH_RESTORE_REPRO_SPEC_MARKER,
  "conversation-session-turn-error-queue-preserved.test.ts",
  "conversation-session-turn-error-history-activity.test.ts",
] as const;
const MODEL_RETRY_MAX_RETRIES_ENV = "CF_MODEL_RETRY_MAX_RETRIES";
const HTTP_PROXY_ENV = "CF_HTTP_PROXY";
const NO_PROXY_ENV = "CF_NO_PROXY";

interface E2EWorkerNetworkEnvSnapshot {
  httpProxy: string | undefined;
  noProxy: string | undefined;
}

export function applyE2EWorkerModelRetryEnv(
  env: Record<string, string | undefined>,
  specs: string[],
  configuredMaxRetries: string | undefined,
): void {
  if (MODEL_RETRY_DISABLED_SPEC_MARKERS.some((marker) => workerSpecsContain(specs, marker))) {
    env[MODEL_RETRY_MAX_RETRIES_ENV] = "0";
    return;
  }

  if (configuredMaxRetries === undefined) {
    delete env[MODEL_RETRY_MAX_RETRIES_ENV];
  } else {
    env[MODEL_RETRY_MAX_RETRIES_ENV] = configuredMaxRetries;
  }
}

export function applyE2EWorkerReplayProxyEnv(
  env: Record<string, string | undefined>,
  specs: string[],
  replayBaseUrl: string,
  configuredEnv: E2EWorkerNetworkEnvSnapshot,
): void {
  if (REPLAY_PROXY_ISOLATED_SPEC_MARKERS.some((marker) => workerSpecsContain(specs, marker))) {
    env[HTTP_PROXY_ENV] = replayBaseUrl;
    env[NO_PROXY_ENV] = "";
    return;
  }

  restoreEnvValue(env, HTTP_PROXY_ENV, configuredEnv.httpProxy);
  restoreEnvValue(env, NO_PROXY_ENV, configuredEnv.noProxy);
}

export function resolveE2EWorkerModelStreamIdleTimeoutMs(
  specs: string[],
): number | undefined {
  if (workerSpecsContain(specs, SSE_STALL_DIAGNOSTIC_SPEC_MARKER)) {
    return SSE_STALL_DIAGNOSTIC_IDLE_TIMEOUT_MS;
  }
  if (!REPLAY_PROXY_ISOLATED_SPEC_MARKERS.some((marker) => workerSpecsContain(specs, marker))) {
    return undefined;
  }

  return REPLAY_MODEL_STREAM_IDLE_TIMEOUT_MS;
}

export function resolveE2EWebDriverRequestLimits(overrides: {
  retryCount?: string;
  timeoutMs?: string;
}): { retryCount: number; timeoutMs: number } {
  return {
    retryCount: resolveBoundedInteger(
      overrides.retryCount,
      DEFAULT_E2E_WEBDRIVER_REQUEST_RETRY_COUNT,
      0,
      MAX_E2E_WEBDRIVER_REQUEST_RETRY_COUNT,
    ),
    timeoutMs: resolveBoundedInteger(
      overrides.timeoutMs,
      DEFAULT_E2E_WEBDRIVER_REQUEST_TIMEOUT_MS,
      1,
      MAX_E2E_WEBDRIVER_REQUEST_TIMEOUT_MS,
    ),
  };
}

function resolveBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    return fallback;
  }
  return Math.min(parsed, maximum);
}

function restoreEnvValue(
  env: Record<string, string | undefined>,
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete env[key];
  } else {
    env[key] = value;
  }
}

export function workerSpecsContain(specs: string[], marker: string): boolean {
  return specs.some((spec) => spec.includes(marker));
}

export function resolveE2EWorkerChromiumProfileDir(rootDir: string, cid: string): string {
  const safeCid = cid.replace(/[^a-zA-Z0-9._-]/gu, "-");
  return resolve(rootDir, safeCid || "worker");
}

export function replaceChromeUserDataDirArg(args: string[], profileDir: string): string[] {
  return [
    ...args.filter((arg) => !arg.startsWith("--user-data-dir=")),
    `--user-data-dir=${profileDir}`,
  ];
}
