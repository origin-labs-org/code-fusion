

import type { FaultProgram, Verdict } from "./fake-provider-server.js";

export type StatusVerdict = Extract<Verdict, { kind: "status" }>;

const DEFAULT_RETRY_AFTER_MS = 20;

export const SERVE: Verdict = { kind: "serve" };

export const BUSY_3008: StatusVerdict = {
  kind: "status",
  status: 429,
  code: "3008",
  message: "user concurrency limit exceeded",
  headers: { "retry-after-ms": String(DEFAULT_RETRY_AFTER_MS) },
};

export const AUTH_401: StatusVerdict = {
  kind: "status",
  status: 401,
  code: "1006",
  message: "token expired",
};

export const QUOTA_1308: StatusVerdict = {
  kind: "status",
  status: 429,
  code: "1308",
  message: "usage cap reached for the current 5-hour window",
  headers: { "retry-after": "120" },
};

export const MODEL_NOT_FOUND_3006: StatusVerdict = {
  kind: "status",
  status: 404,
  code: "3006",
  message: "model not available in current plan",
};

export const INVALID_REQUEST_3001: StatusVerdict = {
  kind: "status",
  status: 400,
  code: "3001",
  message: "invalid request parameters",
};

export const UNKNOWN_1314: StatusVerdict = {
  kind: "status",
  status: 429,
  code: "1314",
  message: "unknown business condition",
  headers: { "retry-after-ms": String(DEFAULT_RETRY_AFTER_MS) },
};

export function healthy(): FaultProgram {
  return () => SERVE;
}

const DEFAULT_GATE_HOLD_MS = 30;

export function gate(
  limit: number,
  options: { code?: string; holdMs?: number } = {},
): FaultProgram {
  const verdict: StatusVerdict = { ...BUSY_3008, code: options.code ?? "3008" };
  const served: Verdict = { kind: "delay", ms: options.holdMs ?? DEFAULT_GATE_HOLD_MS, next: SERVE };
  return (request) => (request.inFlight >= limit ? verdict : served);
}

export function failFirst(
  n: number,
  status: number,
  options: { code?: string; message?: string; retryAfterMs?: number } = {},
): FaultProgram {
  const retryAfterMs = options.retryAfterMs ?? (status === 429 ? DEFAULT_RETRY_AFTER_MS : undefined);
  const verdict: Verdict = {
    kind: "status",
    status,
    ...(options.code === undefined ? {} : { code: options.code }),
    ...(options.message === undefined ? {} : { message: options.message }),
    ...(retryAfterMs === undefined ? {} : { headers: { "retry-after-ms": String(retryAfterMs) } }),
  };
  return (request) => (request.ordinal <= n ? verdict : SERVE);
}

export function everyKth(k: number, verdict: Verdict): FaultProgram {
  return (request) => (request.ordinal % k === 0 ? verdict : SERVE);
}

export function cutVisibleUntil(n: number): FaultProgram {
  const verdict: Verdict = { kind: "cut", after: "visible" };
  return (request) => (request.ordinal <= n && request.stream ? verdict : SERVE);
}

export function always(verdict: Verdict): FaultProgram {
  return () => verdict;
}
