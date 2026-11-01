import type {
  DynamicWorkflowRunError,
  DynamicWorkflowRunLifecycleStatus,
  DynamicWorkflowRunStopReason,
  ModelUsage,
} from "@origin-ai/cf-contracts";
import type { RuntimeTaskType } from "./registry.js";
import { formatWorkflowProviderStopError } from "./workflow-notification-copy.js";

export {
  formatWorkflowEscalationNotification,
  formatWorkflowProviderStopError,
  formatWorkflowStallNotification,
  type WorkflowEscalationNotificationInput,
  type WorkflowStallNotificationInput,
} from "./workflow-notification-copy.js";

const TASK_NOTIFICATION_MAX_CHARS = 120_000;

export interface TaskNotificationInput {
  agentId?: string;
  description?: string;
  error?: string;
  outputFile?: string;
  
  reports?: { count: number; preview: string; shown: number };
  
  artifacts?: { count: number; preview: string; shown: number };
  
  deliveryGuidance?: boolean;
  result?: string;
  status: string;
  
  runStatus?: Extract<DynamicWorkflowRunLifecycleStatus, "completed" | "errored" | "stopped">;
  
  stopReason?: DynamicWorkflowRunStopReason;
  
  scriptPath?: string;
  
  failure?: DynamicWorkflowRunError;
  stderrFile?: string;
  stdoutFile?: string;
  subagentType?: string;
  summary: string;
  taskId: string;
  taskType: RuntimeTaskType;
  toolUseId?: string;
  usage?: {
    durationMs?: number;
    modelUsage?: ModelUsage;
    toolUseCount?: number;
    totalTokens?: number;
  };
}

export function formatTaskNotification(input: TaskNotificationInput): string {
  if (input.taskType === "local_agent") {
    return formatLocalAgentTaskNotification(input);
  }
  if (input.taskType === "local_bash") {
    return formatLocalBashTaskNotification(input);
  }
  if (input.taskType === "local_workflow") {
    return formatLocalWorkflowTaskNotification(input);
  }

  const lines = ["<task-notification>", `  <task-id>${escapeXml(input.taskId)}</task-id>`];

  if (input.toolUseId) lines.push(`  <tool-use-id>${escapeXml(input.toolUseId)}</tool-use-id>`);
  lines.push(`  <task-type>${escapeXml(input.taskType)}</task-type>`);
  if (input.agentId) lines.push(`  <agent-id>${escapeXml(input.agentId)}</agent-id>`);
  if (input.subagentType) {
    lines.push(`  <subagent-type>${escapeXml(input.subagentType)}</subagent-type>`);
  }
  if (input.outputFile) lines.push(`  <output-file>${escapeXml(input.outputFile)}</output-file>`);
  if (input.stdoutFile) lines.push(`  <stdout-file>${escapeXml(input.stdoutFile)}</stdout-file>`);
  if (input.stderrFile) lines.push(`  <stderr-file>${escapeXml(input.stderrFile)}</stderr-file>`);
  lines.push(`  <status>${escapeXml(input.status)}</status>`);
  if (input.description) {
    lines.push(`  <description>${escapeXml(input.description)}</description>`);
  }
  lines.push(`  <summary>${escapeXml(input.summary)}</summary>`);
  if (input.result !== undefined) lines.push(`  <result>${escapeXml(input.result)}</result>`);
  if (input.error !== undefined) lines.push(`  <error>${escapeXml(input.error)}</error>`);
  const usage = formatUsage(input.usage);
  if (usage.length > 0) {
    lines.push("  <usage>", ...usage.map((line) => `    ${line}`), "  </usage>");
  }
  lines.push("</task-notification>");

  return truncateTaskNotification(lines.join("\n"));
}

function formatLocalBashTaskNotification(input: TaskNotificationInput): string {
  const lines = ["<task-notification>", `<task-id>${escapeLocalBashXml(input.taskId)}</task-id>`];
  if (input.toolUseId) {
    lines.push(`<tool-use-id>${escapeLocalBashXml(input.toolUseId)}</tool-use-id>`);
  }
  if (input.outputFile) {
    lines.push(`<output-file>${escapeLocalBashXml(input.outputFile)}</output-file>`);
  }
  lines.push(`<status>${escapeLocalBashXml(input.status)}</status>`);
  lines.push(`<summary>${escapeLocalBashXml(input.summary)}</summary>`);
  lines.push("</task-notification>");

  return lines.join("\n");
}

function formatLocalAgentTaskNotification(input: TaskNotificationInput): string {
  const lines = ["<task-notification>", `<task-id>${escapeXml(input.taskId)}</task-id>`];
  if (input.toolUseId) lines.push(`<tool-use-id>${escapeXml(input.toolUseId)}</tool-use-id>`);
  if (input.outputFile) lines.push(`<output-file>${escapeXml(input.outputFile)}</output-file>`);
  lines.push(`<status>${escapeXml(input.status)}</status>`);
  lines.push(`<summary>${escapeXml(input.summary)}</summary>`);
  if (input.result !== undefined) lines.push(`<result>${escapeXml(input.result)}</result>`);
  if (input.error !== undefined) lines.push(`<error>${escapeXml(input.error)}</error>`);

  const usage = formatLocalAgentUsage(input.usage);
  if (usage) lines.push(usage);
  lines.push("</task-notification>");

  return truncateTaskNotification(lines.join("\n"));
}

function formatLocalWorkflowTaskNotification(input: TaskNotificationInput): string {
  const lines = ["<task-notification>", `<task-id>${escapeXml(input.taskId)}</task-id>`];
  if (input.toolUseId) lines.push(`<tool-use-id>${escapeXml(input.toolUseId)}</tool-use-id>`);
  if (input.outputFile) lines.push(`<output-file>${escapeXml(input.outputFile)}</output-file>`);
  lines.push(`<status>${escapeXml(input.runStatus ?? input.status)}</status>`);
  if (input.stopReason !== undefined) {
    lines.push(`<stop-reason>${escapeXml(input.stopReason)}</stop-reason>`);
  }
  if (input.description) {
    lines.push(`<description>${escapeXml(input.description)}</description>`);
  }
  lines.push(`<summary>${escapeXml(input.summary)}</summary>`);
  if (input.result !== undefined) lines.push(`<result>${escapeXml(input.result)}</result>`);
  const providerStopError =
    input.failure?.providerStop === undefined
      ? undefined
      : formatWorkflowProviderStopError(input.failure, input.taskId);
  if (providerStopError !== undefined) {
    lines.push(`<error>\n${escapeLocalBashXml(providerStopError)}\n</error>`);
  } else if (input.error !== undefined) {
    lines.push(`<error>${escapeXml(input.error)}</error>`);
  }
  if (input.reports !== undefined) {
    const shown = input.reports.shown < input.reports.count ? ` shown="${input.reports.shown}"` : "";
    lines.push(
      `<reports count="${input.reports.count}"${shown}>`,
      escapeXml(input.reports.preview),
      "</reports>",
    );
  }
  if (input.artifacts !== undefined) {
    const shown =
      input.artifacts.shown < input.artifacts.count ? ` shown="${input.artifacts.shown}"` : "";
    lines.push(
      `<artifacts count="${input.artifacts.count}"${shown}>`,
      escapeXml(input.artifacts.preview),
      "</artifacts>",
    );
  }
  lines.push("</task-notification>");
  if (input.deliveryGuidance) {
    lines.push(
      "",
      workflowDeliveryGuidance({
        status: input.runStatus ?? input.status,
        stopReason: input.stopReason,
        hasArtifacts: input.artifacts !== undefined,
        runId: input.taskId,
        scriptPath: input.scriptPath,
      }),
    );
  }

  return truncateTaskNotification(lines.join("\n"));
}

function workflowDeliveryGuidance(input: {
  status: string;
  stopReason: DynamicWorkflowRunStopReason | undefined;
  hasArtifacts: boolean;
  runId: string;
  scriptPath: string | undefined;
}): string {
  const { status, stopReason, hasArtifacts, scriptPath } = input;
  const artifactsSentence = hasArtifacts
    ? [
        "Artifacts listed above are already in front of the user as cards; refer to them by title and do not paste their contents. The one marked primary is the deliverable: point the user to it first.",
      ]
    : [];
  const artifactsShort = hasArtifacts
    ? ["Artifacts listed above are already in front of the user."]
    : [];
  if (status === "completed") {
    return [
      "The workflow completed. Present its outcome to the user as a deliverable, in this order: the conclusion; each finding with its evidence (path and line, or the command and output that showed it); which findings were confirmed by a deterministic check or an independent subagent and which are judged only; what the run did not cover.",
      "The reported items above are individual findings: present them individually and keep their evidence. When the preview is partial (count greater than shown), say so and read the rest with GetWorkflowRun.",
      ...artifactsSentence,
      "Do not restate the phase graph or the script.",
    ].join("\n");
  }
  if (stopReason === "user") {
    return [
      "The user stopped this workflow on purpose. Do not resume it with ResumeWorkflowRun and do not amend or rebuild it unless the user asks you to.",
      "Present what it finished before it was stopped: the reported items above are finished findings — show them individually with their evidence. Then stop and wait for the user to say what happens next.",
      ...artifactsShort,
    ].join("\n");
  }
  if (stopReason === "model") {
    return [
      `You stopped this workflow with TaskStop. If you stopped it to fix the script, do that now: call AmendWorkflow with this run's ID and the corrected script — everything that settled before the stop is imported as cache, and the sooner the fix runs the less it re-pays. (Next time, amend the running run directly: AmendWorkflow stops it for you.)${
        scriptPath === undefined ? "" : ` Its script is at ${scriptPath}: edit that file and pass \`path\`.`
      }`,
      "Otherwise present what it finished: the reported items above are finished findings — show them individually with their evidence. Resume it unchanged only if that is what the user wants.",
      ...artifactsShort,
    ].join("\n");
  }
  if (stopReason === "provider") {
    return [
      "A provider-side error stopped this run; the <error> block above names the cause and the fix. Present what the run finished: the reported items above are finished findings — show them individually with their evidence.",
      `Then resolve the cause with the user before calling ResumeWorkflowRun with run_id="${input.runId}" — finished steps replay from the journal. Do not rebuild the workflow.`,
      ...artifactsShort,
    ].join("\n");
  }
  if (stopReason === "interrupted") {
    return [
      "The process that owned this run exited before it finished. Present what it finished: the reported items above are finished findings — show them individually with their evidence.",
      `Then call ResumeWorkflowRun with run_id="${input.runId}" — finished steps replay from the journal and only the unfinished ones run again.`,
      ...artifactsShort,
    ].join("\n");
  }
  if (stopReason === "superseded") {
    return [
      "This run was stopped because you amended it: a newer run supersedes it and is already running. Do not resume this run and do not amend it again; wait for the successor's notification.",
      ...artifactsShort,
    ].join("\n");
  }
  if (status === "stopped") {
    return [
      "This workflow was stopped before it finished. Present what it salvaged first: the reported items above are finished findings — show them individually with their evidence.",
      `It can be continued with ResumeWorkflowRun (run_id="${input.runId}"); ask the user before resuming a run you did not stop yourself.`,
      ...artifactsShort,
    ].join("\n");
  }
  if (status === "errored") {
    return [
      "The workflow script failed. Present what it salvaged first: the reported items above are finished findings — show them individually with their evidence. Then explain the failure and what it means for the user's request.",
      ...artifactsShort,
      scriptPath === undefined
        ? `Fix the script and submit it with AmendWorkflow (run_id="${input.runId}") so finished work is reused. ResumeWorkflowRun will refuse this run: replaying the same script would fail the same way.`
        : `The run's script is at ${scriptPath}. Edit that file in place, then call AmendWorkflow (run_id="${input.runId}", path="${scriptPath}") so finished work is reused — do not paste the script inline. ResumeWorkflowRun will refuse this run: replaying the same script would fail the same way.`,
    ].join("\n");
  }
  return [
    "The workflow did not complete. Present what it salvaged first: the reported items above are finished findings — show them individually with their evidence. Then explain the failure and what it means for the user's request.",
    ...artifactsShort,
    "If the script itself was wrong, a corrected script submitted with AmendWorkflow re-uses the finished work; if the process died (error code Interrupted), the run is resumable as-is.",
  ].join("\n");
}

function formatLocalAgentUsage(input: TaskNotificationInput["usage"]): string | undefined {
  if (!input) return undefined;
  const segments: string[] = [];
  const totalTokens = input.totalTokens ?? input.modelUsage?.totalTokens;
  if (totalTokens !== undefined) {
    segments.push(`<subagent_tokens>${totalTokens}</subagent_tokens>`);
  }
  if (input.toolUseCount !== undefined) {
    segments.push(`<tool_uses>${input.toolUseCount}</tool_uses>`);
  }
  if (input.durationMs !== undefined) {
    segments.push(`<duration_ms>${input.durationMs}</duration_ms>`);
  }
  if (segments.length === 0) return undefined;
  return `<usage>${segments.join("")}</usage>`;
}

function formatUsage(input: TaskNotificationInput["usage"]): string[] {
  if (!input) return [];
  const lines: string[] = [];
  if (input.totalTokens !== undefined) {
    lines.push(`<total-tokens>${input.totalTokens}</total-tokens>`);
  }
  if (input.toolUseCount !== undefined) {
    lines.push(`<tool-uses>${input.toolUseCount}</tool-uses>`);
  }
  if (input.durationMs !== undefined) {
    lines.push(`<duration-ms>${input.durationMs}</duration-ms>`);
  }
  if (input.modelUsage?.inputTokens !== undefined) {
    lines.push(`<input-tokens>${input.modelUsage.inputTokens}</input-tokens>`);
  }
  if (input.modelUsage?.outputTokens !== undefined) {
    lines.push(`<output-tokens>${input.modelUsage.outputTokens}</output-tokens>`);
  }
  if (input.modelUsage?.cacheReadTokens !== undefined) {
    lines.push(`<cache-read-tokens>${input.modelUsage.cacheReadTokens}</cache-read-tokens>`);
  }
  if (input.modelUsage?.cacheWriteTokens !== undefined) {
    lines.push(`<cache-write-tokens>${input.modelUsage.cacheWriteTokens}</cache-write-tokens>`);
  }
  if (input.modelUsage?.reasoningTokens !== undefined) {
    lines.push(`<reasoning-tokens>${input.modelUsage.reasoningTokens}</reasoning-tokens>`);
  }
  return lines;
}

export function truncateTaskNotification(value: string): string {
  if (value.length <= TASK_NOTIFICATION_MAX_CHARS) return value;
  return `${value.slice(0, TASK_NOTIFICATION_MAX_CHARS)}\n[truncated]`;
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/gu, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return char;
    }
  });
}

function escapeLocalBashXml(value: string): string {
  return value.replace(/[<>&]/gu, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      default:
        return char;
    }
  });
}
