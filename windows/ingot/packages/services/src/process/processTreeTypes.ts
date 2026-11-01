import type { TraceId } from "@origin-ai/cf-shared";

export interface ProcessTreeTerminatorLogger {
  debug?: (traceId: TraceId | undefined, ...args: unknown[]) => void;
  warn: (traceId: TraceId | undefined, ...args: unknown[]) => void;
}

export interface WindowsTaskkillRequest {
  force: boolean;
  pid: number;
  timeoutMs: number;
}

export interface WindowsTaskkillResult {
  error?: unknown;
  stderr?: string;
}

export type WindowsTaskkillRunner = (
  request: WindowsTaskkillRequest,
) => Promise<WindowsTaskkillResult>;

export interface ProcessTreeTerminatorOptions {
  traceId?: TraceId;
  log?: ProcessTreeTerminatorLogger;
  forceAfterMs?: number;
  keepForceTimerRef?: boolean;
  
  ownedProcessGroupId?: number;
  
  ownedProcessStartedAtMs?: number;
  
  ownedProcessExitedAtMs?: number;
  
  resolveOwnedProcessExitedAtMs?: () => number | undefined;
  
  windowsTaskkillRunner?: WindowsTaskkillRunner;
  
  windowsTaskkillTimeoutMs?: number;
  
  windowsCleanupDeadlineAtMs?: number;
}

export interface ProcessIdentity {
  parentPid: number;
  pid: number;
  processGroupId?: number;
  startTime: string;
}

export interface ProcessTreeOwnershipResolution {
  childStillOwned: boolean;
  currentIdentities: ProcessIdentity[];
  knownIdentities: ProcessIdentity[];
}

export interface ProcessTreeTerminationResult {
  remainingPids: number[];
}

export interface ProcessTreeSnapshot {
  rootPid: number;
  descendantPids: readonly number[];
  identities: readonly ProcessIdentity[];
  
  identityVerification?: "verified" | "unavailable";
}

export interface ProcessTreeTerminatorWaitOptions extends ProcessTreeTerminatorOptions {
  snapshot?: ProcessTreeSnapshot;
  waitAfterForceMs?: number;
}
