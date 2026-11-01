// ============================================================
// ============================================================
//
//

import type { RuntimeCommand } from "../command-queue.js";
import type { DynamicWorkflowRunProgressPayload } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import {
  WorkflowBlockedReminderClock,
  type WorkflowBlockedReminder,
  type WorkflowOpenDecisions,
} from "../../runtime-task/workflow-blocked-reminder.js";
import { formatWorkflowBlockedNotification } from "../../runtime-task/workflow-notification-copy.js";

const WORKFLOW_RUN_TASK_TYPE = "local_dynamic_workflow";

const RUNNING_TASK_STATUS = "running";

const OPEN_SET_EVENT_TYPES: ReadonlySet<string> = new Set([
  "escalation-raised",
  "escalation-resolved",
  "hole-reached",
  "hole-filled",
]);

export function createWorkflowBlockedReminder(
  runtime: AgentRuntimeInternal,
): WorkflowBlockedReminderClock {
  return new WorkflowBlockedReminderClock({
    isIdle: () => !runtime.shuttingDown && !runtime.hasActiveOrQueuedTurnWork(),
    liveRunIds: () => liveWorkflowRunIds(runtime),
    onReadError: (runId, error) => {
      runtime.logger?.warn?.("Dynamic workflow blocked reminder: snapshot read failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
        event: "dynamic_workflow.blocked.snapshot_failed",
        module: "core.runtime",
        runId,
      });
    },
    readOpen: (runId) => readOpenDecisions(runtime, runId),
    remind: (reminder) => {
      enqueueBlockedReminder(runtime, reminder);
    },
  });
}

function liveWorkflowRunIds(runtime: AgentRuntimeInternal): string[] {
  const live: string[] = [];
  for (const task of Object.values(runtime.runtimeTaskRegistry.all())) {
    if (task.type !== WORKFLOW_RUN_TASK_TYPE || task.status !== RUNNING_TASK_STATUS) continue;
    if ((task.branchGeneration ?? runtime.branchGeneration) !== runtime.branchGeneration) continue;
    live.push(task.taskId);
  }
  return live;
}

async function readOpenDecisions(
  runtime: AgentRuntimeInternal,
  runId: string,
): Promise<WorkflowOpenDecisions | undefined> {
  const snapshot = await runtime.dynamicWorkflowRunPort?.getTask(runId);
  if (snapshot === undefined) return undefined;
  const questions = snapshot.pendingQuestions ?? [];
  const holes = (snapshot.holes ?? []).filter((hole) => hole.state === "waiting");
  if (questions.length + holes.length === 0) return undefined;
  return {
    questions,
    holes,
    ...(snapshot.scriptPath === undefined ? {} : { draftPath: snapshot.scriptPath }),
  };
}

function enqueueBlockedReminder(
  runtime: AgentRuntimeInternal,
  reminder: WorkflowBlockedReminder,
): void {
  const { runId, open, now } = reminder;
  const runLabel = runtime.runtimeTaskRegistry.get(runId)?.description ?? runId;
  const sinceMs = Math.max(
    0,
    ...open.questions.map((question) => Math.floor(now - question.askedAt)),
    ...open.holes.map((hole) => (hole.since === undefined ? 0 : Math.floor(now - hole.since))),
  );
  runtime.logger?.info?.("Dynamic workflow blocked reminder sent", {
    event: "dynamic_workflow.blocked.reminder_sent",
    holes: open.holes.length,
    module: "core.runtime",
    ordinal: reminder.ordinal,
    questions: open.questions.length,
    runId,
    sinceMs,
  });
  runtime.enqueueBackgroundTaskNotification({
    originMeta: {
      backgroundSource: "workflow",
      title: runLabel,
      workId: runId,
      workflowBlocked: {
        questions: open.questions.length,
        holes: open.holes.length,
        sinceMs,
      },
    },
    taskId: runId,
    text: formatWorkflowBlockedNotification({
      runLabel,
      runId,
      ordinal: reminder.ordinal,
      total: reminder.total,
      now,
      questions: open.questions,
      holes: open.holes,
      ...(open.draftPath === undefined ? {} : { draftPath: open.draftPath }),
    }),
    traceContext: runtime.rootTraceContext,
  });
}

export function noteWorkflowReminderCommandStarted(
  runtime: AgentRuntimeInternal,
  command: RuntimeCommand,
): void {
  const clock = runtime.workflowBlockedReminder;
  if (clock === undefined) return;
  clock.sessionBusy();
  if (command.mode === "prompt" && command.options?.inputSource === undefined) clock.userSpoke();
}

export function noteWorkflowReminderRunEvent(
  runtime: AgentRuntimeInternal,
  payload: DynamicWorkflowRunProgressPayload,
): void {
  if (!OPEN_SET_EVENT_TYPES.has(payload.eventType)) return;
  runtime.workflowBlockedReminder?.openSetChanged(payload.runId);
}
