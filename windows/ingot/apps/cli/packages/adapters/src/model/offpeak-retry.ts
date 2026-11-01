
import type { ClassifiedModelFailure } from "./failure-classifier.js";
import { isProviderBusinessError } from "./model-execution.js";

export const OFF_PEAK_TICKET_EXPIRED_MARKER = "off-peak-ticket-expired";

export const OFF_PEAK_QUEUE_WAIT_CAP_MS = 5 * 60_000;
export const OFF_PEAK_QUEUE_WAIT_DEFAULT_MS = 60_000;

export type OffPeakFailureDecision =
  | { kind: "queued"; delayMs: number }
  | { kind: "ticketExpired" };

export function resolveOffPeakFailureDecision(params: {
  offPeak: boolean;
  failure: ClassifiedModelFailure;
  error: unknown;
}): OffPeakFailureDecision | null {
  if (!params.offPeak) return null;
  const businessCode = isProviderBusinessError(params.error)
    ? params.error.providerCode
    : undefined;
  if (businessCode === "3102" || businessCode === "3001") {
    return { kind: "ticketExpired" };
  }
  if (businessCode === "3105" || params.failure.statusCode === 429) {
    return {
      kind: "queued",
      delayMs: Math.min(
        params.failure.retryAfterMs ?? OFF_PEAK_QUEUE_WAIT_DEFAULT_MS,
        OFF_PEAK_QUEUE_WAIT_CAP_MS,
      ),
    };
  }
  return null;
}

export function offPeakTicketExpiredMessage(original: string): string {
  return `${OFF_PEAK_TICKET_EXPIRED_MARKER}: ${original}`;
}
