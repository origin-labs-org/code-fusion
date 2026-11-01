import type { CuaAccessibilitySettingsResult } from "@origin-ai/cf-shared";

function normalizeToolName(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/_/g, "-") ?? "";
}

export function isCfCuaToolName(value: string | null | undefined): boolean {
  const normalized = normalizeToolName(value);
  return normalized === "computer-use" || normalized.includes("computer-use");
}

export function didReturnFromCuaPermissionSettings(
  result: CuaAccessibilitySettingsResult | null | undefined,
): boolean {
  return (
    result?.success === true &&
    result.returnedFromSettings === true &&
    typeof result.sessionId === "string" &&
    result.sessionId.length > 0
  );
}

export function shouldRestartHelperAfterCuaPermissionReturn(
  result: CuaAccessibilitySettingsResult | null | undefined,
): boolean {
  return didReturnFromCuaPermissionSettings(result) && result?.restartHelperAfterReturn !== false;
}

export interface CuaPermissionReturnRecoveryState {
  
  generation: number;
  contextKey: string;
  epoch: number;
  pending: boolean;
  automaticAttempted: boolean;
}

export interface CuaPermissionReturnRecoveryClaim {
  readonly state: CuaPermissionReturnRecoveryState;
  readonly generation: number;
  readonly contextKey: string;
  readonly epoch: number;
}

let nextCuaPermissionRecoveryGeneration = 0;

export function createCuaPermissionReturnRecoveryState(
  contextKey = "",
): CuaPermissionReturnRecoveryState {
  nextCuaPermissionRecoveryGeneration += 1;
  return {
    generation: nextCuaPermissionRecoveryGeneration,
    contextKey,
    epoch: 0,
    pending: false,
    automaticAttempted: false,
  };
}

function recoveryClaim(state: CuaPermissionReturnRecoveryState): CuaPermissionReturnRecoveryClaim {
  return {
    state,
    generation: state.generation,
    contextKey: state.contextKey,
    epoch: state.epoch,
  };
}

export function markCuaPermissionOnboardingOpened(
  state: CuaPermissionReturnRecoveryState,
): CuaPermissionReturnRecoveryClaim {
  state.epoch += 1;
  state.pending = true;
  state.automaticAttempted = false;
  return recoveryClaim(state);
}

export function claimCuaPermissionReturnRecovery(
  state: CuaPermissionReturnRecoveryState,
): CuaPermissionReturnRecoveryClaim | null {
  if (!state.pending || state.automaticAttempted) return null;
  state.automaticAttempted = true;
  return recoveryClaim(state);
}

export function captureCuaPermissionReturnRecovery(
  state: CuaPermissionReturnRecoveryState,
): CuaPermissionReturnRecoveryClaim | null {
  return state.pending ? recoveryClaim(state) : null;
}

export function isCuaPermissionReturnRecoveryCurrent(
  current: CuaPermissionReturnRecoveryState,
  claim: CuaPermissionReturnRecoveryClaim,
): boolean {
  return (
    current === claim.state &&
    current.generation === claim.generation &&
    current.contextKey === claim.contextKey &&
    current.epoch === claim.epoch &&
    current.pending
  );
}

export function completeCuaPermissionReturnRecovery(
  claim: CuaPermissionReturnRecoveryClaim,
  restartSucceeded: boolean,
): void {
  const state = claim.state;
  if (
    restartSucceeded &&
    state.pending &&
    state.generation === claim.generation &&
    state.contextKey === claim.contextKey &&
    state.epoch === claim.epoch
  ) {
    state.pending = false;
  }
}
