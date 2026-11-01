// ============================================================
// ============================================================
//
//

import { escapeXml } from "../../runtime-task/notification.js";
import type { ToolHandlerFailure } from "../types.js";

const WORKFLOW_RUN_INTROSPECTION_ERROR_CODE = {
  INTROSPECTION_UNAVAILABLE: 1,
  RUN_NOT_FOUND: 2,
} as const;

export function workflowIntrospectionUnavailableFailure(): ToolHandlerFailure {
  return {
    result: false,
    errorCode: WORKFLOW_RUN_INTROSPECTION_ERROR_CODE.INTROSPECTION_UNAVAILABLE,
    message:
      "workflow_introspection_unavailable: this session cannot read workflow runs — workflow execution is not available here, so no run history is reachable. This is a capability gap, not an empty project.",
  };
}

export function workflowRunNotFoundFailure(runId: string): ToolHandlerFailure {
  return {
    result: false,
    errorCode: WORKFLOW_RUN_INTROSPECTION_ERROR_CODE.RUN_NOT_FOUND,
    message: `run_not_found: no workflow run with ID ${runId} exists for this project. Use ListWorkflowRuns to see the runs that do.`,
  };
}

export const WORKFLOW_RUN_INTROSPECTION_STEERING = [
  "Runs this session starts settle on their own: you receive a completion notification carrying the final output. Do NOT poll this tool while waiting for one — continue with other work.",
  "Reach for it when: (a) the user asks how a workflow is going, (b) you want to review this project's earlier runs, including ones other sessions started, (c) a completion notification was truncated and you need the run's full record by ID.",
].join("\n");

export function formatWorkflowRunTimestamp(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return String(epochMs);
  try {
    return new Date(epochMs).toISOString();
  } catch {
    return String(epochMs);
  }
}

const DURATION_MS = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;

function padTwo(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatWorkflowRunDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (total < DURATION_MS.minute) return `${Math.floor(total / DURATION_MS.second)}s`;
  if (total < DURATION_MS.hour) {
    const minutes = Math.floor(total / DURATION_MS.minute);
    const seconds = Math.floor((total % DURATION_MS.minute) / DURATION_MS.second);
    return `${minutes}m ${padTwo(seconds)}s`;
  }
  if (total < DURATION_MS.day) {
    const hours = Math.floor(total / DURATION_MS.hour);
    const minutes = Math.floor((total % DURATION_MS.hour) / DURATION_MS.minute);
    return `${hours}h ${padTwo(minutes)}m`;
  }
  const days = Math.floor(total / DURATION_MS.day);
  const hours = Math.floor((total % DURATION_MS.day) / DURATION_MS.hour);
  return `${days}d ${hours}h`;
}

export function formatRelativeAge(now: number, at: number | undefined): string | undefined {
  if (at === undefined || !Number.isFinite(at) || !Number.isFinite(now)) return undefined;
  return `${formatWorkflowRunDuration(now - at)} ago`;
}

export function formatWorkflowRunInstant(now: number, at: number): string {
  const age = formatRelativeAge(now, at);
  const iso = formatWorkflowRunTimestamp(at);
  return age === undefined ? iso : `${iso} (${age})`;
}

export function formatWorkflowRunCount(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const sign = value < 0 ? "-" : "";
  const digits = String(Math.trunc(Math.abs(value)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

export function workflowRunAttribute(name: string, value: string | number | boolean): string {
  const text = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : String(value);
  return `${name}="${escapeXml(text)}"`;
}

export { escapeXml as escapeWorkflowRunText };
