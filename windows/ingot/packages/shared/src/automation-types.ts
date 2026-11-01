import type { CfTaskMode } from "./cf-task-types-core.js";
import type { CfAutomationBotDeliveryTarget } from "./bots.js";
import type { ModelSelection } from "./model-selection.js";

export const AUTOMATION_CREATE_LIMIT = 20;
export const AUTOMATION_CREATE_LIMIT_ERROR_CODE = "AUTOMATION_CREATE_LIMIT_REACHED";

export function isAutomationCreateLimitError(error: unknown): boolean {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return message.includes(AUTOMATION_CREATE_LIMIT_ERROR_CODE);
}

export type CfAutomationLifecycleStatus = "active" | "completed" | "failed" | "paused";

export type CfAutomationDispatchStatus =
  | "idle"
  | "claimed"
  | "dispatched"
  | "failed_to_dispatch";

export type CfAutomationLocationKind = "local" | "remote";

export type CfAutomationTrigger = "schedule" | "manual";

export interface CfAutomationScheduleRule {
  unit: "minute" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  hour: number;
  minute: number;
  anchorAt: number;
  weekdays?: number[];
  monthDays?: number[];
  
  months?: number[];
  monthlyMode?: "date" | "weekday";
}

export type CfAutomationIntervalUnit = CfAutomationScheduleRule["unit"];

export type CfAutomationRunDispatchStatus =
  | "claimed"
  | "dispatched"
  | "failed_to_dispatch"
  | "skipped";

export type CfAutomationRunOutcome = "running" | "succeeded" | "failed" | "stopped";

export interface CfAutomation {
  projectId?: string | null;
  hostId?: string;
  
  additionalDirectories?: string[];
  automationId: string;
  title: string;
  
  cronExpr: string;
  prompt: string;
  
  modelSelection?: ModelSelection;
  
  mode?: CfTaskMode;
  /** workspaceIdentity?.trim() || workspacePath */
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  
  targetTaskId?: string;
  locationKind: CfAutomationLocationKind;
  
  recurring: boolean;
  maxRuns?: number;
  
  endAt?: number;
  scheduleRule?: CfAutomationScheduleRule;
  
  scheduleEditedByUser?: boolean;
  runCount: number;
  enabled: boolean;
  lifecycleStatus: CfAutomationLifecycleStatus;
  nextRunAt?: number;
  lastRunAt?: number;
  dispatchStatus: CfAutomationDispatchStatus;
  dispatchAttempts: number;
  retryAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CfAutomationRunIdParts {
  automationId: string;
  trigger: CfAutomationTrigger;
  
  scheduledAt?: number;
}

export function parseAutomationRunId(runId: string): CfAutomationRunIdParts | null {
  const separatorIndex = runId.indexOf(":");
  if (separatorIndex <= 0) return null;
  const automationId = runId.slice(0, separatorIndex);
  const rest = runId.slice(separatorIndex + 1);
  if (rest.startsWith("manual:")) {
    return rest.length > "manual:".length ? { automationId, trigger: "manual" } : null;
  }
  const scheduledAt = Number(rest);
  if (!Number.isSafeInteger(scheduledAt) || scheduledAt <= 0) return null;
  return { automationId, trigger: "schedule", scheduledAt };
}

export interface CfAutomationRun {
  /** automationId:scheduledAt / automationId:manual:uuid */
  runId: string;
  automationId: string;
  workspaceKey: string;
  scheduledAt?: number;
  trigger: CfAutomationTrigger;
  
  modelSelection?: ModelSelection;
  dispatchStatus: CfAutomationRunDispatchStatus;
  outcome?: CfAutomationRunOutcome;
  
  sessionId?: string;
  error?: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

export interface CfAutomationCreateParams {
  projectId?: string | null;
  hostId?: string;
  
  additionalDirectories?: string[];
  title: string;
  cronExpr: string;
  
  relativeDelayMinutes?: number;
  prompt: string;
  modelSelection?: ModelSelection;
  mode?: CfTaskMode;
  workspacePath: string;
  workspaceIdentity?: string;
  
  targetTaskId?: string;
  
  botDeliveryTarget?: CfAutomationBotDeliveryTarget;
  recurring: boolean;
  maxRuns?: number;
  endAt?: number;
  scheduleRule?: CfAutomationScheduleRule;
  
  intervalUnit?: CfAutomationIntervalUnit;
  
  interval?: number;
}

export interface CfAutomationUpdateParams {
  title?: string;
  cronExpr?: string;
  prompt?: string;
  
  modelSelection?: ModelSelection | null;
  
  mode?: CfTaskMode | null;
  recurring?: boolean;
  
  maxRuns?: number | null;
  
  endAt?: number | null;
  
  scheduleRule?: CfAutomationScheduleRule | null;
  
  intervalUnit?: CfAutomationIntervalUnit;
  
  interval?: number;
  
  scheduleEditedByUser?: boolean;
}

export interface ProjectExecutionSnapshot {
  projectId: string | null;
  hostId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  additionalDirectories: string[];
}
