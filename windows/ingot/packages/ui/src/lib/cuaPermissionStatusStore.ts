
import { isCuaPermissionStatusAvailable } from "@origin-ai/cf-services";
import type {
  CuaPermissionStatus,
  CuaPermissionStatusQueryOptions,
  CuaPermissionStatusResult,
  ICuaPermissionService,
} from "@origin-ai/cf-services";

import {
  persistCuaPermissionStatus,
  readCachedCuaPermissionStatus,
} from "./cuaPermissionStatusCache.js";

export interface CuaPermissionStatusSnapshot {
  
  status: CuaPermissionStatusResult | null;
  
  fresh: boolean;
  
  settled: boolean;
}

let initialSnapshotCache: CuaPermissionStatusSnapshot | null = null;

function initialSnapshot(): CuaPermissionStatusSnapshot {
  if (!initialSnapshotCache) {
    const cached = readCachedCuaPermissionStatus();
    initialSnapshotCache = { status: cached, fresh: false, settled: cached !== null };
  }
  return initialSnapshotCache;
}

interface Slot {
  snapshot: CuaPermissionStatusSnapshot;
  inFlight: boolean;
  
  rerunRequested: boolean;
  
  pendingFunctionalProbe: boolean;
  
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  
  retryAttempt: number;
  
  stickyReady: CuaPermissionStatus | null;
}

const slots = new Map<string, Slot>();
const listeners = new Set<() => void>();

export function cuaPermissionStatusKey(workspacePath: string, workspaceIdentity?: string): string {
  return [workspacePath, workspaceIdentity?.trim() ?? ""].join("\u0000");
}

export function subscribeCuaPermissionStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCuaPermissionStatusSnapshot(key: string | null): CuaPermissionStatusSnapshot {
  if (!key) return initialSnapshot();
  return slots.get(key)?.snapshot ?? initialSnapshot();
}

export function resetCuaPermissionStatusStoreForTest(): void {
  for (const slot of slots.values()) clearTransientRetry(slot);
  slots.clear();
  listeners.clear();
  initialSnapshotCache = null;
}

function ensureSlot(key: string): Slot {
  const existing = slots.get(key);
  if (existing) return existing;
  const created: Slot = {
    snapshot: initialSnapshot(),
    inFlight: false,
    rerunRequested: false,
    pendingFunctionalProbe: false,
    retryTimer: undefined,
    retryAttempt: 0,
    stickyReady: null,
  };
  slots.set(key, created);
  return created;
}

function clearTransientRetry(slot: Slot): void {
  if (slot.retryTimer) clearTimeout(slot.retryTimer);
  slot.retryTimer = undefined;
}

function publish(slot: Slot, snapshot: CuaPermissionStatusSnapshot): void {
  if (
    slot.snapshot.status === snapshot.status &&
    slot.snapshot.fresh === snapshot.fresh &&
    slot.snapshot.settled === snapshot.settled
  )
    return;
  slot.snapshot = snapshot;
  for (const listener of listeners) listener();
}

export function isCuaPermissionTccGranted(result: CuaPermissionStatusResult | null): boolean {
  return (
    !!result &&
    "accessibility" in result &&
    result.accessibility === "granted" &&
    result.screenRecording === "granted"
  );
}

function isFunctionallyReady(result: CuaPermissionStatusResult | null): boolean {
  return (
    !!result &&
    "accessibility" in result &&
    result.accessibility === "granted" &&
    result.accessibilityProbeOk === true &&
    result.screenRecording === "granted" &&
    result.screenCaptureProbeOk === true
  );
}

function withStickyProbes(slot: Slot, result: CuaPermissionStatusResult): CuaPermissionStatusResult {
  if (!("accessibility" in result)) {
    slot.stickyReady = null;
    return result;
  }
  if (isFunctionallyReady(result)) {
    slot.stickyReady = result;
    return result;
  }
  if (
    slot.stickyReady &&
    result.accessibility === "granted" &&
    result.screenRecording === "granted"
  ) {
    return {
      ...result,
      accessibilityProbeOk: slot.stickyReady.accessibilityProbeOk,
      screenCaptureProbeOk: slot.stickyReady.screenCaptureProbeOk,
    };
  }
  slot.stickyReady = null;
  return result;
}

const TRANSIENT_RETRY_DELAYS_MS = [1000, 2000, 4000];

function scheduleTransientRetry(slot: Slot, params: FetchCuaPermissionStatusParams): boolean {
  const delay = TRANSIENT_RETRY_DELAYS_MS[slot.retryAttempt];
  if (delay === undefined) {
    slot.retryAttempt = 0;
    return false;
  }
  slot.retryAttempt += 1;
  clearTransientRetry(slot);
  slot.retryTimer = setTimeout(() => {
    slot.retryTimer = undefined;
    const { service, workspacePath, workspaceIdentity } = params;
    fetchCuaPermissionStatus({ service, workspacePath, workspaceIdentity, mode: "retry" });
  }, delay);
  return true;
}

export interface FetchCuaPermissionStatusParams {
  service: ICuaPermissionService;
  workspacePath: string;
  workspaceIdentity?: string;
  options?: CuaPermissionStatusQueryOptions;
  
  mode?: "refresh" | "ensure" | "retry";
}

export function fetchCuaPermissionStatus(params: FetchCuaPermissionStatusParams): void {
  const { service, workspacePath, workspaceIdentity, options, mode = "refresh" } = params;
  const key = cuaPermissionStatusKey(workspacePath, workspaceIdentity);
  const slot = ensureSlot(key);
  slot.pendingFunctionalProbe ||= options?.includeFunctionalProbes === true;
  if (slot.inFlight) {
    if (mode === "refresh") slot.rerunRequested = true;
    return;
  }
  if (mode !== "retry") {
    clearTransientRetry(slot);
    slot.retryAttempt = 0;
  }
  slot.inFlight = true;
  const includeFunctionalProbes = slot.pendingFunctionalProbe;
  slot.pendingFunctionalProbe = false;
  publish(slot, { status: slot.snapshot.status, fresh: false, settled: slot.snapshot.settled });

  let completed: CuaPermissionStatusResult | null = null;
  void Promise.resolve()
    .then(() => service.getStatus(workspacePath, workspaceIdentity, { includeFunctionalProbes }))
    .then((result) => {
      completed = result;
    })
    .catch(() => {
    })
    .finally(() => {
      slot.inFlight = false;
      if (slot.rerunRequested) {
        slot.rerunRequested = false;
        fetchCuaPermissionStatus({ service, workspacePath, workspaceIdentity });
        return;
      }
      //
      const transient = !completed || !isCuaPermissionStatusAvailable(completed);
      if (transient && scheduleTransientRetry(slot, params)) {
        publish(slot, {
          status: slot.snapshot.status,
          fresh: false,
          settled: slot.snapshot.settled,
        });
        return;
      }
      if (!completed) {
        publish(slot, {
          status: slot.snapshot.status,
          fresh: false,
          settled: slot.snapshot.settled,
        });
        return;
      }
      slot.retryAttempt = 0;
      const published = withStickyProbes(slot, completed);
      publish(slot, { status: published, fresh: true, settled: true });
      persistCuaPermissionStatus(published);
    });
}
