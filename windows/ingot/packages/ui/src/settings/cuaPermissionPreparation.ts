import type { CuaPermissionKind } from "@origin-ai/cf-shared";
import type { CuaPermissionStatus } from "@origin-ai/cf-services";

function isActionablePermissionState(state: CuaPermissionStatus["accessibility"]): boolean {
  return state === "denied" || state === "stale";
}

export function requiredCuaPermissionsForFreshStatus(
  status: CuaPermissionStatus | null,
): CuaPermissionKind[] {
  if (!status) return [];
  const required: CuaPermissionKind[] = [];
  if (isActionablePermissionState(status.accessibility)) {
    required.push("accessibility");
  }
  if (isActionablePermissionState(status.screenRecording)) {
    required.push("screen_recording");
  }
  return required;
}
