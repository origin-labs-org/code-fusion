import {
  AutomationRepo,
  computeAutomationNextRunAt,
  isOneShotAutomation,
  OffPeakTaskRepo,
} from "@origin-ai/cf-services/node";
import {
  resolveWorkspaceKey,
  type CfAutomation,
  type CfAutomationTrigger,
  type CfAutomationRun,
  type CfOffPeakTask,
} from "@origin-ai/cf-shared";
import type { MainToSchedulerMessage, SchedulerToMainMessage } from "./schedulerProtocol.js";
import { settleManualClaimForDispatchResult } from "./manualClaimRelease.js";
import { settleOffPeakDispatchResult } from "./offPeakDispatchSettlement.js";
import {
  startSchedulerResourceTelemetry,
  type SchedulerResourceTelemetry,
} from "./schedulerResourceTelemetry.js";

const POLL_INTERVAL_MS = 20_000;

const MISFIRE_GRACE_MS = 5 * 60_000;

const { parentPort } = process;

type InFlight = {
  automationId: string;
  workspaceKey: string;
  trigger: CfAutomationTrigger;
};

const repo = new AutomationRepo();

const inFlight = new Map<string, InFlight>();

const offPeakRepo = new OffPeakTaskRepo();

const offPeakRetryAt = new Map<string, number>();
const offPeakRetryAttempts = new Map<string, number>();

const offPeakInFlight = new Set<string>();

let ticking = false;
let tickRequested = false;
let schedulerReady = false;
let disposed = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

let resourceTelemetry: SchedulerResourceTelemetry | null = null;

function log(level: "info" | "warn" | "error", message: string): void {
  const msg: SchedulerToMainMessage = { type: "scheduler-log", level, message };
  parentPort?.postMessage(msg);
  if (!parentPort) {
    console[level === "error" ? "error" : "log"](`[scheduler] ${message}`);
  }
}

function resolveScheduledAt(automation: CfAutomation, now: number): number {
  return automation.nextRunAt ?? automation.retryAt ?? now;
}

function buildRunId(automationId: string, scheduledAt: number): string {
  return `${automationId}:${scheduledAt}`;
}

async function tick(): Promise<void> {
  if (disposed || !schedulerReady || ticking) return;
  ticking = true;
  try {
    do {
      tickRequested = false;
      try {
        const now = Date.now();
        const claimed = await repo.claimDue(now);
        for (const automation of claimed) {
          await handleClaimed(automation, now);
        }
        const manualRuns = await repo.claimManualRuns(now);
        for (const manualRun of manualRuns) {
          await handleClaimedManual(manualRun.automation, manualRun.run);
        }
        const offPeakClaimed = await offPeakRepo.claimDue(now);
        for (const task of offPeakClaimed) {
          await handleOffPeakClaimed(task, now);
        }
        await reportOffPeakActiveCount();
      } catch (error) {
        log("error", `tick failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } while (tickRequested && !disposed);
  } finally {
    ticking = false;
  }
}

function requestTick(): void {
  if (disposed) return;
  if (!schedulerReady || ticking) {
    tickRequested = true;
    return;
  }
  void tick();
}

async function handleClaimed(automation: CfAutomation, now: number): Promise<void> {
  const scheduledAt = resolveScheduledAt(automation, now);
  const runId = buildRunId(automation.automationId, scheduledAt);
  const workspaceKey = resolveWorkspaceKey({
    workspacePath: automation.workspacePath,
    workspaceIdentity: automation.workspaceIdentity,
  });
  const isRetry = automation.dispatchAttempts > 0;

  const missed =
    !isRetry && automation.nextRunAt != null && automation.nextRunAt <= now - MISFIRE_GRACE_MS;
  if (missed) {
    const finalize = isOneShotAutomation(automation);
    const nextRunAt = finalize ? null : computeAutomationNextRunAt(automation, now);
    await repo.skipAndReschedule({
      automationId: automation.automationId,
      runId,
      workspaceKey,
      scheduledAt,
      reason: "computer_asleep_or_app_not_running",
      nextRunAt,
      finalize,
    });
    log(
      "info",
      `skip missed window automation=${automation.automationId} scheduledAt=${scheduledAt}${finalize ? " finalized=one-shot" : ""}`,
    );
    return;
  }

  await repo.upsertRunClaimed({
    runId,
    automationId: automation.automationId,
    workspaceKey,
    scheduledAt,
    trigger: "schedule",
  });
  inFlight.set(runId, {
    automationId: automation.automationId,
    workspaceKey,
    trigger: "schedule",
  });
  const run = await repo.getRun(runId);
  postDispatchRequest(automation, runId, run?.modelSelection);
}

function postDispatchRequest(
  automation: CfAutomation,
  runId: string,
  fixedSelection?: CfAutomationRun["modelSelection"],
): void {
  const request: SchedulerToMainMessage = {
    type: "cron-dispatch-request",
    automationId: automation.automationId,
    runId,
    prompt: automation.prompt,
    ...(automation.targetTaskId ? { targetTaskId: automation.targetTaskId } : {}),
    ...((fixedSelection ?? automation.modelSelection)
      ? { modelSelection: fixedSelection ?? automation.modelSelection }
      : {}),
    ...(automation.mode ? { mode: automation.mode } : {}),
    workspacePath: automation.workspacePath,
    projectId: automation.projectId,
    hostId: automation.hostId,
    additionalDirectories: automation.additionalDirectories,
    ...(automation.workspaceIdentity ? { workspaceIdentity: automation.workspaceIdentity } : {}),
  };
  parentPort?.postMessage(request);
}

async function handleClaimedManual(
  automation: CfAutomation,
  run: CfAutomationRun,
): Promise<void> {
  inFlight.set(run.runId, {
    automationId: automation.automationId,
    workspaceKey: resolveWorkspaceKey({
      workspacePath: automation.workspacePath,
      workspaceIdentity: automation.workspaceIdentity,
    }),
    trigger: "manual",
  });
  postDispatchRequest(automation, run.runId, run.modelSelection);
}

let lastOffPeakActiveCount = -1;
async function reportOffPeakActiveCount(): Promise<void> {
  try {
    const count = await offPeakRepo.countActive();
    if (count === lastOffPeakActiveCount) return;
    lastOffPeakActiveCount = count;
    const msg: SchedulerToMainMessage = { type: "offpeak-active-count", count };
    parentPort?.postMessage(msg);
  } catch (error) {
    log(
      "warn",
      `off-peak active count report failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function handleOffPeakClaimed(task: CfOffPeakTask, now: number): Promise<void> {
  const retryAt = offPeakRetryAt.get(task.offPeakTaskId) ?? 0;
  if (retryAt > now) {
    await offPeakRepo.releaseClaim(task.offPeakTaskId, { now });
    return;
  }
  if (!task.modelSelection) {
    await offPeakRepo.releaseClaim(task.offPeakTaskId, { now });
    log(
      "warn",
      `off-peak task claimed without model selection, released task=${task.offPeakTaskId}`,
    );
    return;
  }
  offPeakInFlight.add(task.offPeakTaskId);
  const request: SchedulerToMainMessage = {
    type: "offpeak-dispatch-request",
    offPeakTaskId: task.offPeakTaskId,
    prompt: task.prompt,
    permissionMode: task.permissionMode,
    modelSelection: task.modelSelection,
    ...(task.conversationId ? { conversationId: task.conversationId } : {}),
    ...(task.sessionId ? { sessionId: task.sessionId } : {}),
    ...(task.serverTicketId ? { serverTicketId: task.serverTicketId } : {}),
    workspacePath: task.workspacePath,
    projectId: task.projectId,
    hostId: task.hostId,
    additionalDirectories: task.additionalDirectories,
    ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
  };
  parentPort?.postMessage(request);
  log("info", `off-peak dispatch requested task=${task.offPeakTaskId}`);
}

async function settleDispatchResult(
  msg: Extract<MainToSchedulerMessage, { type: "cron-dispatch-result" }>,
): Promise<void> {
  const context = inFlight.get(msg.runId);
  inFlight.delete(msg.runId);
  const now = Date.now();
  const automationId = context?.automationId ?? msg.runId.split(":")[0]!;
  const workspaceKey = context?.workspaceKey;
  const trigger: CfAutomationTrigger =
    context?.trigger ?? (msg.runId.includes(":manual:") ? "manual" : "schedule");
  const settleManualClaim = async (ok: boolean): Promise<void> => {
    await settleManualClaimForDispatchResult({
      repo,
      automationId,
      runId: msg.runId,
      workspaceKey,
      ok,
      logError: (message) => log("error", message),
    });
  };

  if (msg.ok) {
    if (trigger === "manual") {
      await repo.markManualRunDispatched({
        runId: msg.runId,
        sessionId: msg.sessionId ?? null,
        dispatchedAt: now,
      });
      await settleManualClaim(true);
      return;
    }
    await repo.markRunDispatch({
      runId: msg.runId,
      dispatchStatus: "dispatched",
      sessionId: msg.sessionId ?? null,
    });
    const automation = await repo.get(automationId);
    const nextRunAt = automation ? computeAutomationNextRunAt(automation, now) : null;
    await repo.markDispatched(automationId, { dispatchedAt: now, nextRunAt });
    return;
  }

  await repo.markRunDispatch({
    runId: msg.runId,
    dispatchStatus: "failed_to_dispatch",
    error: msg.error ?? "dispatch failed",
  });
  if (trigger === "manual") {
    await settleManualClaim(false);
    return;
  }
  const kind = msg.failureKind ?? "transient";
  await repo.markDispatchFailed(automationId, {
    failedAt: now,
    error: msg.error ?? "dispatch failed",
    kind,
    nextRunAt: await repo
      .get(automationId)
      .then((automation) => (automation ? computeAutomationNextRunAt(automation, now) : null)),
  });
}

async function dispose(): Promise<void> {
  if (disposed) return;
  disposed = true;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  resourceTelemetry?.stop();
  resourceTelemetry = null;
  for (const [, context] of inFlight) {
    try {
      if (context.trigger === "manual") {
        await repo.releaseManualClaim(context.automationId, context.workspaceKey);
      } else {
        await repo.releaseClaim(context.automationId);
      }
    } catch {
    }
  }
  inFlight.clear();
  for (const offPeakTaskId of offPeakInFlight) {
    try {
      await offPeakRepo.releaseClaim(offPeakTaskId);
    } catch {
    }
  }
  offPeakInFlight.clear();
  try {
    repo.close();
  } catch {
  }
  try {
    offPeakRepo.close();
  } catch {
  }
  process.exit(0);
}

parentPort?.on("message", (event: Electron.MessageEvent) => {
  const msg = event.data as MainToSchedulerMessage;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "scheduler-dispose") {
    void dispose();
    return;
  }
  if (msg.type === "cron-dispatch-result") {
    void settleDispatchResult(msg)
      .then(() => {
        requestTick();
      })
      .catch((error) => {
        log(
          "error",
          `settle dispatch result failed runId=${msg.runId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    return;
  }
  if (msg.type === "offpeak-dispatch-result") {
    offPeakInFlight.delete(msg.offPeakTaskId);
    void settleOffPeakDispatchResult(
      {
        repo: offPeakRepo,
        retryAt: offPeakRetryAt,
        retryAttempts: offPeakRetryAttempts,
        now: Date.now,
        log,
      },
      msg,
    ).catch((error) => {
      log(
        "error",
        `settle off-peak dispatch result failed task=${msg.offPeakTaskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return;
  }
  if (msg.type === "scheduler-wake") {
    log("info", `manual run wake requested automation=${msg.automationId}`);
    requestTick();
  }
});

async function main(): Promise<void> {
  await repo.ensureReady();
  try {
    const recovered = await offPeakRepo.recoverInterrupted(Date.now());
    if (recovered > 0) {
      log("info", `off-peak recovered ${recovered} interrupted task(s) back to queued`);
    }
  } catch (error) {
    log(
      "error",
      `off-peak recoverInterrupted failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  schedulerReady = true;
  log("info", "cron scheduler started");
  requestTick();
  pollTimer = setInterval(requestTick, POLL_INTERVAL_MS);
  resourceTelemetry = startSchedulerResourceTelemetry({
    postMessage: (message) => parentPort?.postMessage(message),
  });
}

void main().catch((error) => {
  log(
    "error",
    `scheduler bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
