import { createHash } from "node:crypto";
import type { Logger, WorkspaceHookReasonCode } from "@origin-ai/cf-contracts";

export type WorkspaceHookTelemetryEvent =
  | "workspace_hook.feature_disabled"
  | "workspace_hook.review_request_created"
  | "workspace_hook.trust_selected"
  | "workspace_hook.review_timeout"
  | "workspace_hook.review_superseded"
  | "workspace_hook.snapshot_mismatch"
  | "workspace_hook.policy_blocked"
  | "workspace_hook.trust_store_failure"
  | "workspace_hook.toggle_failure"
  | "workspace_hook.config_rebuild_failure"
  | "workspace_hook.revoked"
  | "workspace_hook.stale_response";

export interface WorkspaceHookTelemetryFields {
  workspaceIdentity?: string;
  bundleDigest?: string;
  declarationDigest?: string;
  reasonCode?: WorkspaceHookReasonCode;
  source?: string;
  action?: string;
  generation?: number;
  
  errorMessage?: string;
  
  requestItemCount?: number;
  requestEnabledCount?: number;
  grantedRecordCount?: number;
  
  revokedCount?: number;
}

const MAX_TELEMETRY_ERROR_MESSAGE_LENGTH = 300;

export function emitWorkspaceHookTelemetry(
  logger: Logger | undefined,
  event: WorkspaceHookTelemetryEvent,
  fields: WorkspaceHookTelemetryFields = {},
): void {
  if (!logger) return;
  logger.info("Workspace Hook Trust telemetry", {
    event,
    module: "workspace_hook_trust",
    ...(fields.workspaceIdentity
      ? { workspaceIdentityDigest: workspaceIdentitySummary(fields.workspaceIdentity) }
      : {}),
    ...(fields.bundleDigest ? { bundleDigest: digestSummary(fields.bundleDigest) } : {}),
    ...(fields.declarationDigest
      ? { declarationDigest: digestSummary(fields.declarationDigest) }
      : {}),
    ...(fields.reasonCode ? { reasonCode: fields.reasonCode } : {}),
    ...(fields.source ? { source: fields.source } : {}),
    ...(fields.action ? { action: fields.action } : {}),
    ...(fields.generation === undefined ? {} : { generation: fields.generation }),
    ...(fields.errorMessage
      ? { errorMessage: fields.errorMessage.slice(0, MAX_TELEMETRY_ERROR_MESSAGE_LENGTH) }
      : {}),
    ...(fields.requestItemCount === undefined ? {} : { requestItemCount: fields.requestItemCount }),
    ...(fields.requestEnabledCount === undefined
      ? {}
      : { requestEnabledCount: fields.requestEnabledCount }),
    ...(fields.grantedRecordCount === undefined
      ? {}
      : { grantedRecordCount: fields.grantedRecordCount }),
    ...(fields.revokedCount === undefined ? {} : { revokedCount: fields.revokedCount }),
  });
}

export function digestSummary(value: string): string {
  return value.length <= 12 ? value : value.slice(0, 12);
}

export function workspaceIdentitySummary(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
