import { z } from "zod";
export const cfTaskModeSchema = z.enum([
  "default",
  "yolo",
  "plan",
  "edit",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
  "autoEdit",
  "build",
]);
function rowToAutomation(row) {
  return {
    automationId: row.automation_id,
    title: row.title,
    cronExpr: row.cron_expr,
    prompt: row.prompt,
    model: row.model ?? undefined,
    provider: row.provider ?? undefined,
    mode: normalizeAutomationMode(row.mode),
    thoughtLevel: row.thought_level ?? undefined,
    workspaceKey: row.workspace_key,
    workspacePath: row.workspace_path,
    workspaceIdentity: row.workspace_identity ?? undefined,
    targetTaskId: row.target_task_id ?? undefined,
    locationKind: row.location_kind === "remote" ? "remote" : "local",
    recurring: row.recurring === 1,
    maxRuns: row.max_runs ?? undefined,
    endAt: row.end_at ?? undefined,
    scheduleRule: row.schedule_rule ? JSON.parse(row.schedule_rule) : undefined,
    ...(row.schedule_edited_by_user === 1 ? { scheduleEditedByUser: true } : {}),
    runCount: row.run_count,
    enabled: row.enabled === 1,
    lifecycleStatus: row.lifecycle_status,
    nextRunAt: row.next_run_at ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    dispatchStatus: row.dispatch_status,
    dispatchAttempts: row.dispatch_attempts,
    retryAt: row.retry_at ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function normalizeAutomationMode(mode) {
  const parsed = cfTaskModeSchema.safeParse(mode);
  return parsed.success ? parsed.data : undefined;
}
function rowToRun(row) {
  return {
    runId: row.run_id,
    automationId: row.automation_id,
    workspaceKey: row.workspace_key,
    scheduledAt: row.scheduled_at ?? undefined,
    trigger: row.trigger,
    dispatchStatus: row.dispatch_status,
    outcome: row.outcome ?? undefined,
    sessionId: row.session_id ?? undefined,
    error: row.error ?? undefined,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function rowToTask(row) {
  return {
    offPeakTaskId: row.off_peak_task_id,
    serverTicketId: row.server_ticket_id ?? undefined,
    title: row.title,
    conversationId: row.conversation_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    ...(row.session_title ? { sessionTitle: row.session_title } : {}),
    prompt: row.prompt,
    permissionMode: row.permission_mode,
    model: row.model ?? undefined,
    thoughtLevel: row.thought_level ?? undefined,
    workspaceKey: row.workspace_key,
    workspacePath: row.workspace_path,
    workspaceIdentity: row.workspace_identity ?? undefined,
    status: row.status,
    queuedAt: row.queued_at,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    filesChanged: row.files_changed ?? undefined,
    settledAt: row.settled_at ?? undefined,
    historyDeletedAt: row.history_deleted_at ?? undefined,
    registeredAt: row.registered_at ?? undefined,
    schedulable: row.schedulable === 1,
    queuePosition: row.queue_position ?? undefined,
    nextPollAt: row.next_poll_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export { rowToAutomation, rowToRun, rowToTask };
