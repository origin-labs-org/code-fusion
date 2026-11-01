
import {
  isCuaPermissionStatusAvailable,
  type CuaPermissionState,
  type CuaPermissionStatus,
  type CuaPermissionStatusResult,
} from "@origin-ai/cf-services";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const CUA_PERMISSION_STATUS_CACHE_KEY = "cf-cua-permission-status";

export const CUA_PERMISSION_STATUS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PERMISSION_STATES: readonly CuaPermissionState[] = [
  "granted",
  "stale",
  "denied",
  "unknown",
];

interface CachedEnvelope {
  savedAt: number;
  status: CuaPermissionStatus;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isPermissionState(value: unknown): value is CuaPermissionState {
  return PERMISSION_STATES.includes(value as CuaPermissionState);
}

function parseCachedStatus(value: unknown): CuaPermissionStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.grantOwner !== "string" ||
    !isPermissionState(candidate.accessibility) ||
    !isPermissionState(candidate.screenRecording) ||
    typeof candidate.accessibilityProbeOk !== "boolean" ||
    typeof candidate.screenCaptureProbeOk !== "boolean"
  ) {
    return null;
  }
  if (
    candidate.grantOwnerDisplayName !== undefined &&
    typeof candidate.grantOwnerDisplayName !== "string"
  ) {
    return null;
  }

  const parsed: CuaPermissionStatus = {
    grantOwner: candidate.grantOwner,
    accessibility: candidate.accessibility,
    accessibilityProbeOk: candidate.accessibilityProbeOk,
    screenRecording: candidate.screenRecording,
    screenCaptureProbeOk: candidate.screenCaptureProbeOk,
  };
  if (typeof candidate.grantOwnerDisplayName === "string") {
    parsed.grantOwnerDisplayName = candidate.grantOwnerDisplayName;
  }
  return parsed;
}

export function readCachedCuaPermissionStatus(
  storage: StorageLike | null = getBrowserStorage(),
  now: number = Date.now(),
): CuaPermissionStatus | null {
  let raw: string | null;
  try {
    raw = storage?.getItem(CUA_PERMISSION_STATUS_CACHE_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;

  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;

  const { savedAt, status } = envelope as Partial<CachedEnvelope>;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  const age = now - savedAt;
  if (age < 0 || age > CUA_PERMISSION_STATUS_CACHE_TTL_MS) return null;

  return parseCachedStatus(status);
}

export function persistCuaPermissionStatus(
  status: CuaPermissionStatusResult,
  storage: StorageLike | null = getBrowserStorage(),
  now: number = Date.now(),
): void {
  if (!isCuaPermissionStatusAvailable(status)) return;

  const envelope: CachedEnvelope = { savedAt: now, status };
  try {
    storage?.setItem(CUA_PERMISSION_STATUS_CACHE_KEY, JSON.stringify(envelope));
  } catch {
  }
}
