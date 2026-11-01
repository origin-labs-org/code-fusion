import type {
  CodingPlanQuotaResetAutoPlayReservation,
  CodingPlanQuotaResetAutoPlayReservationAttempt,
} from "@/store/codingPlanQuotaResetState.js";

export type CodingPlanQuotaResetAutoPlayCoordinationResult =
  | { status: "committed" }
  | { status: "released" }
  | { status: "retry"; retryAfterMs: number }
  | { status: "blocked" };

export async function coordinateCodingPlanQuotaResetAutoPlay(params: {
  reserve: () => Promise<CodingPlanQuotaResetAutoPlayReservationAttempt>;
  isCurrent: () => boolean;
  commit: (reservation: CodingPlanQuotaResetAutoPlayReservation) => boolean;
  release: (reservation: CodingPlanQuotaResetAutoPlayReservation) => Promise<void>;
  onCommitted: (reservation: CodingPlanQuotaResetAutoPlayReservation) => void;
}): Promise<CodingPlanQuotaResetAutoPlayCoordinationResult> {
  const attempt = await params.reserve();
  if (attempt.status === "retry") {
    return attempt;
  }
  if (attempt.status === "blocked") {
    return attempt;
  }

  const { reservation } = attempt;
  if (!params.isCurrent()) {
    await params.release(reservation);
    return { status: "released" };
  }
  if (!params.commit(reservation)) {
    await params.release(reservation);
    return { status: "released" };
  }

  params.onCommitted(reservation);
  return { status: "committed" };
}
