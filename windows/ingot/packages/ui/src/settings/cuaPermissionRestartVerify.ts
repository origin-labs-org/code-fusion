//
//
import { isCuaPermissionStatusAvailable, type CuaPermissionStatusResult } from "@origin-ai/cf-services";

export interface WaitForAccessibilityNotStaleOptions {
  
  timeoutMs?: number;
  
  intervalMs?: number;
}

export type GetCuaPermissionStatusFn = () => Promise<CuaPermissionStatusResult>;

const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_INTERVAL_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForAccessibilityNotStale(
  getStatus: GetCuaPermissionStatusFn,
  options: WaitForAccessibilityNotStaleOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const result = await getStatus();
      if (isCuaPermissionStatusAvailable(result) && result.accessibility !== "stale") {
        return false;
      }
    } catch {
    }
    if (Date.now() >= deadline) return true;
    await sleep(intervalMs);
  }
}
