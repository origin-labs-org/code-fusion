// ============================================================
// Off-Peak Port - idle-time task creation boundary
// ============================================================

import type { OffPeakCreateInput, OffPeakTaskSummary } from "../tools/off-peak.js";

export type OffPeakCreateFailureStage = "client_validation" | "ticket_request" | "local_persist";

export type OffPeakCreateErrorCategory =
  | "client_validation"
  | "eligibility_3101"
  | "quota_3103"
  | "network"
  | "invalid_response"
  | "local_persist"
  | "unknown";

export type OffPeakCreateOutcome =
  | { ok: true; task: OffPeakTaskSummary }
  | {
      ok: false;
      failureStage: OffPeakCreateFailureStage;
      errorCategory: OffPeakCreateErrorCategory;
      errorCode: string;
    };

export function isOffPeakQuotaFailure(
  outcome: OffPeakCreateOutcome,
): outcome is Extract<OffPeakCreateOutcome, { ok: false }> {
  return !outcome.ok && outcome.errorCategory === "quota_3103";
}

export function isOffPeakEligibilityFailure(
  outcome: OffPeakCreateOutcome,
): outcome is Extract<OffPeakCreateOutcome, { ok: false }> {
  return !outcome.ok && outcome.errorCategory === "eligibility_3101";
}

export interface OffPeakCreateContext {
  
  sessionId?: string;
}

export interface OffPeakPort {
  create(input: OffPeakCreateInput, context?: OffPeakCreateContext): Promise<OffPeakCreateOutcome>;
  list(): Promise<OffPeakTaskSummary[]>;
}
