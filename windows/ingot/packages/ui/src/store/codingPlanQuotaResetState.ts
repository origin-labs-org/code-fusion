import type { BroadcastClaimLease, BroadcastMessage, IBroadcastService } from "@origin-ai/cf-services";
import type { CodingPlanResetType } from "@origin-ai/cf-shared";
import type {
  CodingPlanQuotaResetUiEntries,
  CodingPlanQuotaResetUiEntry,
} from "@/lib/codingPlanQuotaResetUi.js";

export interface CodingPlanQuotaResetAutomaticObservation {
  completedAt: number;
  
  authSessionSeq: number;
}

export interface CodingPlanQuotaResetAutomaticObservations {
  fiveHour: CodingPlanQuotaResetAutomaticObservation | null;
  week: CodingPlanQuotaResetAutomaticObservation | null;
}

export interface CodingPlanQuotaResetAutoPlayedSlot {
  fiveHour: number | null;
  week: number | null;
}

export interface CodingPlanQuotaResetStoreState {
  authSessionSeq: number;
  codingPlanQuotaResetUiBySource: Record<string, CodingPlanQuotaResetUiEntries>;
  codingPlanQuotaResetAutomaticObservationsBySource: Record<
    string,
    CodingPlanQuotaResetAutomaticObservations
  >;
  codingPlanQuotaResetAutoPlayedBySource: Record<string, CodingPlanQuotaResetAutoPlayedSlot>;
}

export const CODING_PLAN_QUOTA_RESET_AUTO_PLAYED_CHANNEL = "state:codereset-autoplayed";

export interface CodingPlanQuotaResetAutoPlayedBroadcastPayload {
  sourceKey: string;
  resetType: CodingPlanResetType;
  completedAt: number;
}

export function buildCodingPlanQuotaResetAutoPlayClaimKey(
  sourceKey: string,
  resetType: CodingPlanResetType,
  completedAt: number,
): string {
  return `coding-plan-reset-autoplay:${encodeURIComponent(sourceKey)}:${resetType}:${completedAt}`;
}

export function parseCodingPlanQuotaResetAutoPlayedPayload(
  payload: unknown,
): CodingPlanQuotaResetAutoPlayedBroadcastPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const sourceKey = typeof record.sourceKey === "string" ? record.sourceKey.trim() : "";
  const resetType =
    record.resetType === "WEEK" || record.resetType === "FIVE_HOUR" ? record.resetType : null;
  const completedAt =
    typeof record.completedAt === "number" && Number.isFinite(record.completedAt)
      ? record.completedAt
      : null;
  if (!sourceKey || !resetType || completedAt === null) {
    return null;
  }
  return { sourceKey, resetType, completedAt };
}

export function parseCodingPlanQuotaResetAutoPlayedBroadcastMessage(
  message: Pick<BroadcastMessage, "channel" | "payload" | "sourceWindowId">,
): CodingPlanQuotaResetAutoPlayedBroadcastPayload | null {
  if (message.channel !== CODING_PLAN_QUOTA_RESET_AUTO_PLAYED_CHANNEL) {
    return null;
  }
  if (message.sourceWindowId === undefined) {
    return null;
  }
  return parseCodingPlanQuotaResetAutoPlayedPayload(message.payload);
}

export function broadcastCodingPlanQuotaResetAutoPlayed(
  broadcastService: Pick<IBroadcastService, "send">,
  sourceKey: string,
  resetType: CodingPlanResetType,
  completedAt: number,
): void {
  void broadcastService.send({
    channel: CODING_PLAN_QUOTA_RESET_AUTO_PLAYED_CHANNEL,
    payload: { sourceKey, resetType, completedAt },
  });
}

export interface CodingPlanQuotaResetStoreUpdate {
  patch: Pick<
    CodingPlanQuotaResetStoreState,
    | "codingPlanQuotaResetUiBySource"
    | "codingPlanQuotaResetAutomaticObservationsBySource"
    | "codingPlanQuotaResetAutoPlayedBySource"
  >;
}

export function updateCodingPlanQuotaResetStoreState(
  state: CodingPlanQuotaResetStoreState,
  sourceKey: string,
  resetType: CodingPlanResetType,
  entry: CodingPlanQuotaResetUiEntry | null,
  authSessionSeq: number,
): CodingPlanQuotaResetStoreUpdate {
  if (state.authSessionSeq !== authSessionSeq) {
    return {
      patch: {
        codingPlanQuotaResetUiBySource: state.codingPlanQuotaResetUiBySource,
        codingPlanQuotaResetAutomaticObservationsBySource:
          state.codingPlanQuotaResetAutomaticObservationsBySource,
        codingPlanQuotaResetAutoPlayedBySource: state.codingPlanQuotaResetAutoPlayedBySource,
      },
    };
  }

  const nextEntries = { ...state.codingPlanQuotaResetUiBySource };
  const current = nextEntries[sourceKey] ?? { fiveHour: null, week: null };
  const updated =
    resetType === "WEEK" ? { ...current, week: entry } : { ...current, fiveHour: entry };
  if (updated.fiveHour === null && updated.week === null) {
    delete nextEntries[sourceKey];
  } else {
    nextEntries[sourceKey] = updated;
  }

  const automaticCompletedAt =
    entry?.status === "completed" && entry.startedAt === null ? entry.completedAt : null;
  if (automaticCompletedAt === null) {
    return {
      patch: {
        codingPlanQuotaResetUiBySource: nextEntries,
        codingPlanQuotaResetAutomaticObservationsBySource:
          state.codingPlanQuotaResetAutomaticObservationsBySource,
        codingPlanQuotaResetAutoPlayedBySource: state.codingPlanQuotaResetAutoPlayedBySource,
      },
    };
  }

  const currentObservations = state.codingPlanQuotaResetAutomaticObservationsBySource[
    sourceKey
  ] ?? {
    fiveHour: null,
    week: null,
  };
  const previousObservation =
    resetType === "WEEK" ? currentObservations.week : currentObservations.fiveHour;
  if (previousObservation?.completedAt === automaticCompletedAt) {
    return {
      patch: {
        codingPlanQuotaResetUiBySource: nextEntries,
        codingPlanQuotaResetAutomaticObservationsBySource:
          state.codingPlanQuotaResetAutomaticObservationsBySource,
        codingPlanQuotaResetAutoPlayedBySource: state.codingPlanQuotaResetAutoPlayedBySource,
      },
    };
  }

  const nextObservations = {
    ...state.codingPlanQuotaResetAutomaticObservationsBySource,
  };
  const observation = { completedAt: automaticCompletedAt, authSessionSeq };
  nextObservations[sourceKey] =
    resetType === "WEEK"
      ? { ...currentObservations, week: observation }
      : { ...currentObservations, fiveHour: observation };

  return {
    patch: {
      codingPlanQuotaResetUiBySource: nextEntries,
      codingPlanQuotaResetAutomaticObservationsBySource: nextObservations,
      codingPlanQuotaResetAutoPlayedBySource: state.codingPlanQuotaResetAutoPlayedBySource,
    },
  };
}

export function applyCodingPlanQuotaResetAutoPlayedBroadcast(
  state: Pick<
    CodingPlanQuotaResetStoreState,
    "codingPlanQuotaResetUiBySource" | "codingPlanQuotaResetAutoPlayedBySource"
  >,
  payload: CodingPlanQuotaResetAutoPlayedBroadcastPayload,
): Pick<
  CodingPlanQuotaResetStoreState,
  "codingPlanQuotaResetUiBySource" | "codingPlanQuotaResetAutoPlayedBySource"
> {
  const playedBySource = { ...state.codingPlanQuotaResetAutoPlayedBySource };
  const slot = playedBySource[payload.sourceKey] ?? { fiveHour: null, week: null };
  const currentPlayed = payload.resetType === "WEEK" ? slot.week : slot.fiveHour;
  if (currentPlayed === null || payload.completedAt > currentPlayed) {
    playedBySource[payload.sourceKey] =
      payload.resetType === "WEEK"
        ? { ...slot, week: payload.completedAt }
        : { ...slot, fiveHour: payload.completedAt };
  }

  const entriesBySource = { ...state.codingPlanQuotaResetUiBySource };
  const entries = entriesBySource[payload.sourceKey];
  const key = payload.resetType === "WEEK" ? "week" : "fiveHour";
  const entry = entries?.[key];
  if (
    entry &&
    entry.status === "completed" &&
    entry.startedAt === null &&
    entry.completedAt === payload.completedAt &&
    entry.observedAt !== null
  ) {
    entriesBySource[payload.sourceKey] = {
      ...entries,
      [key]: { ...entry, observedAt: null },
    } as CodingPlanQuotaResetUiEntries;
  }

  return {
    codingPlanQuotaResetUiBySource: entriesBySource,
    codingPlanQuotaResetAutoPlayedBySource: playedBySource,
  };
}

type CodingPlanQuotaResetAutoPlayState = Pick<
  CodingPlanQuotaResetStoreState,
  "codingPlanQuotaResetUiBySource" | "codingPlanQuotaResetAutoPlayedBySource"
>;

export interface CodingPlanQuotaResetAutoPlayReservation {
  sourceKey: string;
  resetType: CodingPlanResetType;
  completedAt: number;
  lease: BroadcastClaimLease;
}

export type CodingPlanQuotaResetAutoPlayReservationAttempt =
  | { status: "reserved"; reservation: CodingPlanQuotaResetAutoPlayReservation }
  | { status: "retry"; retryAfterMs: number }
  | { status: "blocked" };

function isCodingPlanQuotaResetAutoPlayCandidate(
  state: CodingPlanQuotaResetAutoPlayState,
  sourceKey: string,
  resetType: CodingPlanResetType,
  completedAt: number,
): boolean {
  const key = resetType === "WEEK" ? "week" : "fiveHour";
  const candidate = state.codingPlanQuotaResetUiBySource[sourceKey]?.[key];
  const played = state.codingPlanQuotaResetAutoPlayedBySource[sourceKey]?.[key] ?? null;
  return Boolean(
    candidate?.status === "completed" &&
    candidate.startedAt === null &&
    candidate.observedAt !== null &&
    candidate.completedAt === completedAt &&
    (played === null || played < completedAt),
  );
}

export async function reserveCodingPlanQuotaResetAutoPlay(params: {
  broadcastService: Pick<IBroadcastService, "acquireClaim" | "releaseClaim">;
  readState: () => CodingPlanQuotaResetAutoPlayState;
  writeState: (
    updater: (state: CodingPlanQuotaResetAutoPlayState) => CodingPlanQuotaResetAutoPlayState,
  ) => void;
  sourceKey: string;
  resetType: CodingPlanResetType;
  completedAt: number;
}): Promise<CodingPlanQuotaResetAutoPlayReservationAttempt> {
  const { broadcastService, readState, writeState, sourceKey, resetType, completedAt } = params;
  const payload = { sourceKey, resetType, completedAt };
  const key = resetType === "WEEK" ? "week" : "fiveHour";
  const initialState = readState();
  const initialPlayed =
    initialState.codingPlanQuotaResetAutoPlayedBySource[sourceKey]?.[key] ?? null;
  if (initialPlayed !== null && initialPlayed >= completedAt) {
    writeState((state) => applyCodingPlanQuotaResetAutoPlayedBroadcast(state, payload));
    return { status: "blocked" };
  }
  if (!isCodingPlanQuotaResetAutoPlayCandidate(initialState, sourceKey, resetType, completedAt)) {
    return { status: "blocked" };
  }

  let claimResult;
  try {
    claimResult = await broadcastService.acquireClaim(
      buildCodingPlanQuotaResetAutoPlayClaimKey(sourceKey, resetType, completedAt),
    );
  } catch {
    return { status: "retry", retryAfterMs: 500 };
  }
  if (claimResult.status === "busy") {
    return { status: "retry", retryAfterMs: Math.max(50, claimResult.retryAfterMs) };
  }
  if (claimResult.status === "unavailable") {
    return { status: "retry", retryAfterMs: 500 };
  }
  if (claimResult.status === "committed") {
    return { status: "blocked" };
  }

  const latestState = readState();
  if (!isCodingPlanQuotaResetAutoPlayCandidate(latestState, sourceKey, resetType, completedAt)) {
    await broadcastService.releaseClaim(claimResult.lease);
    const latestPlayed =
      latestState.codingPlanQuotaResetAutoPlayedBySource[sourceKey]?.[key] ?? null;
    if (latestPlayed !== null && latestPlayed >= completedAt) {
      writeState((state) => applyCodingPlanQuotaResetAutoPlayedBroadcast(state, payload));
    }
    return { status: "blocked" };
  }

  return {
    status: "reserved",
    reservation: { sourceKey, resetType, completedAt, lease: claimResult.lease },
  };
}

export function commitCodingPlanQuotaResetAutoPlay(params: {
  broadcastService: Pick<IBroadcastService, "commitClaim" | "send">;
  writeState: (
    updater: (state: CodingPlanQuotaResetAutoPlayState) => CodingPlanQuotaResetAutoPlayState,
  ) => void;
  reservation: CodingPlanQuotaResetAutoPlayReservation;
}): boolean {
  const { broadcastService, writeState, reservation } = params;
  const { sourceKey, resetType, completedAt } = reservation;
  let committed = false;
  writeState((state) => {
    if (!isCodingPlanQuotaResetAutoPlayCandidate(state, sourceKey, resetType, completedAt)) {
      return state;
    }
    committed = true;
    const slots = state.codingPlanQuotaResetAutoPlayedBySource[sourceKey] ?? {
      fiveHour: null,
      week: null,
    };
    return {
      codingPlanQuotaResetUiBySource: state.codingPlanQuotaResetUiBySource,
      codingPlanQuotaResetAutoPlayedBySource: {
        ...state.codingPlanQuotaResetAutoPlayedBySource,
        [sourceKey]:
          resetType === "WEEK"
            ? { ...slots, week: completedAt }
            : { ...slots, fiveHour: completedAt },
      },
    };
  });
  if (!committed) {
    return false;
  }

  void broadcastService.commitClaim(reservation.lease);
  broadcastCodingPlanQuotaResetAutoPlayed(broadcastService, sourceKey, resetType, completedAt);
  return true;
}

export async function releaseCodingPlanQuotaResetAutoPlay(params: {
  broadcastService: Pick<IBroadcastService, "releaseClaim">;
  reservation: CodingPlanQuotaResetAutoPlayReservation;
}): Promise<void> {
  await params.broadcastService.releaseClaim(params.reservation.lease);
}

export interface CodingPlanQuotaResetStoreActions {
  setCodingPlanQuotaResetUiEntry: (
    sourceKey: string,
    resetType: CodingPlanResetType,
    entry: CodingPlanQuotaResetUiEntry | null,
    authSessionSeq: number,
  ) => void;
  reserveCodingPlanQuotaResetAutoPlay: (
    sourceKey: string,
    resetType: CodingPlanResetType,
    completedAt: number,
  ) => Promise<CodingPlanQuotaResetAutoPlayReservationAttempt>;
  commitCodingPlanQuotaResetAutoPlay: (
    reservation: CodingPlanQuotaResetAutoPlayReservation,
  ) => boolean;
  releaseCodingPlanQuotaResetAutoPlay: (
    reservation: CodingPlanQuotaResetAutoPlayReservation,
  ) => Promise<void>;
}

type CodingPlanQuotaResetStoreWriter = (
  updater: (state: CodingPlanQuotaResetStoreState) => Partial<CodingPlanQuotaResetStoreState>,
) => void;

export function createCodingPlanQuotaResetStoreActions(params: {
  broadcastService: Pick<
    IBroadcastService,
    "acquireClaim" | "commitClaim" | "releaseClaim" | "send"
  >;
  readState: () => CodingPlanQuotaResetStoreState;
  writeState: CodingPlanQuotaResetStoreWriter;
}): CodingPlanQuotaResetStoreActions {
  const { broadcastService, readState, writeState } = params;
  return {
    setCodingPlanQuotaResetUiEntry: (sourceKey, resetType, entry, authSessionSeq) =>
      writeState(
        (state) =>
          updateCodingPlanQuotaResetStoreState(state, sourceKey, resetType, entry, authSessionSeq)
            .patch,
      ),
    reserveCodingPlanQuotaResetAutoPlay: (sourceKey, resetType, completedAt) =>
      reserveCodingPlanQuotaResetAutoPlay({
        broadcastService,
        readState,
        writeState: (updater) => writeState((state) => updater(state)),
        sourceKey,
        resetType,
        completedAt,
      }),
    commitCodingPlanQuotaResetAutoPlay: (reservation) =>
      commitCodingPlanQuotaResetAutoPlay({
        broadcastService,
        writeState: (updater) => writeState((state) => updater(state)),
        reservation,
      }),
    releaseCodingPlanQuotaResetAutoPlay: (reservation) =>
      releaseCodingPlanQuotaResetAutoPlay({ broadcastService, reservation }),
  };
}
