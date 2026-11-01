const CF_JWT_INVALID_RESTART_MARKER_KEY = "cf:auth:jwt-invalid-restart";

interface RestartMarkerStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function resolveStorage(storage?: RestartMarkerStorage): RestartMarkerStorage | null {
  if (storage) {
    return storage;
  }
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function markCfJwtInvalidRestart(storage?: RestartMarkerStorage): void {
  resolveStorage(storage)?.setItem(CF_JWT_INVALID_RESTART_MARKER_KEY, "1");
}

export function consumeCfJwtInvalidRestartMarker(storage?: RestartMarkerStorage): boolean {
  const resolved = resolveStorage(storage);
  if (!resolved || resolved.getItem(CF_JWT_INVALID_RESTART_MARKER_KEY) !== "1") {
    return false;
  }
  resolved.removeItem(CF_JWT_INVALID_RESTART_MARKER_KEY);
  return true;
}
