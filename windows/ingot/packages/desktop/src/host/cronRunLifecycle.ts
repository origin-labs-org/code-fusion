import type {
  CfAutomationRunOutcome,
  CfAutomationTrigger,
} from "@origin-ai/cf-shared";

export interface CronRunLifecycleRepo {
  ensureRunClaimed(params: {
    runId: string;
    automationId: string;
    workspaceKey: string;
    scheduledAt: number | null;
    trigger: CfAutomationTrigger;
  }): Promise<void>;
  markRunOutcome(
    runId: string,
    outcome: CfAutomationRunOutcome,
    error?: string,
  ): Promise<void>;
  markRunDispatch(params: {
    runId: string;
    dispatchStatus: "failed_to_dispatch";
    error: string;
  }): Promise<void>;
  touchManualClaim(automationId: string, workspaceKey: string): Promise<void>;
  releaseManualClaim(automationId: string, workspaceKey: string): Promise<void>;
}

export interface CronRunLifecycleIdentity {
  runId: string;
  automationId: string;
  workspaceKey: string;
  scheduledAt: number | null;
  trigger: CfAutomationTrigger;
}

type LogWarn = (message: string, error: unknown) => void;

const MANUAL_CLAIM_HEARTBEAT_MS = 60_000;

export function startManualClaimHeartbeat(
  params: Pick<CronRunLifecycleIdentity, "automationId" | "runId" | "workspaceKey"> & {
    repo: Pick<CronRunLifecycleRepo, "touchManualClaim">;
    logWarn: LogWarn;
    intervalMs?: number;
  },
): { dispose(): void } {
  const timer = setInterval(() => {
    void params.repo
      .touchManualClaim(params.automationId, params.workspaceKey)
      .catch((error) =>
        params.logWarn(
          `续租 manual automation claim Failed automation=${params.automationId} runId=${params.runId}`,
          error,
        ),
      );
  }, params.intervalMs ?? MANUAL_CLAIM_HEARTBEAT_MS);
  return { dispose: () => clearInterval(timer) };
}

export async function recordCronRunOutcomeBestEffort(
  params: CronRunLifecycleIdentity & {
    repo: CronRunLifecycleRepo;
    outcome: CfAutomationRunOutcome;
    error?: string;
    logWarn: LogWarn;
  },
): Promise<void> {
  try {
    await params.repo.ensureRunClaimed(params);
    await params.repo.markRunOutcome(params.runId, params.outcome, params.error);
  } catch (error) {
    params.logWarn(
      `回写Scheduled TasksRunResultFailed automation=${params.automationId} runId=${params.runId}`,
      error,
    );
  }
}

export async function releaseManualClaimBestEffort(
  params: Pick<CronRunLifecycleIdentity, "automationId" | "runId" | "workspaceKey"> & {
    repo: Pick<CronRunLifecycleRepo, "releaseManualClaim">;
    logWarn: LogWarn;
  },
): Promise<void> {
  try {
    await params.repo.releaseManualClaim(params.automationId, params.workspaceKey);
  } catch (error) {
    params.logWarn(
      `Failed to release manual automation claim automation=${params.automationId} runId=${params.runId}`,
      error,
    );
  }
}

export async function settleManualDispatchFailureBestEffort(
  params: CronRunLifecycleIdentity & {
    repo: CronRunLifecycleRepo;
    dispatchError: unknown;
    logWarn: LogWarn;
  },
): Promise<void> {
  const errorMessage =
    params.dispatchError instanceof Error
      ? params.dispatchError.message
      : String(params.dispatchError);
  try {
    await params.repo.markRunDispatch({
      runId: params.runId,
      dispatchStatus: "failed_to_dispatch",
      error: errorMessage,
    });
  } catch (error) {
    params.logWarn(
      `回写 manual automation 派发FailedStatusFailed automation=${params.automationId} runId=${params.runId}`,
      error,
    );
  }
  await releaseManualClaimBestEffort(params);
}

export async function settleCronRunTerminalOutcome(
  params: CronRunLifecycleIdentity & {
    repo: CronRunLifecycleRepo;
    outcome: Exclude<CfAutomationRunOutcome, "running">;
    error?: string;
    logWarn: LogWarn;
  },
): Promise<void> {
  await recordCronRunOutcomeBestEffort(params);
  if (params.trigger !== "manual") return;
  await releaseManualClaimBestEffort(params);
}
