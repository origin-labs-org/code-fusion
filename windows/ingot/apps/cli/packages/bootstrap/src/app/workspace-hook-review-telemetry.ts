import type { Logger, WorkspaceHookReasonCode } from "@origin-ai/cf-contracts";
import {
  emitWorkspaceHookTelemetry,
  type WorkspaceHookReviewTarget,
  type WorkspaceHookRuntimeAdmissionPort,
} from "@origin-ai/cf-core";
import type {
  WorkspaceHookReviewDecision,
  WorkspaceHookReviewRequestPayload,
} from "@origin-ai/cf-shared/cf-protocol-v4";

export class WorkspaceHookReviewTelemetry {
  constructor(
    private readonly admission: WorkspaceHookRuntimeAdmissionPort,
    private readonly logger?: Logger,
  ) {}

  requestCreated(request: WorkspaceHookReviewRequestPayload): void {
    this.emit("workspace_hook.review_request_created", {
      bundleDigest: request.bundleDigest,
      generation: request.generation,
      requestItemCount: request.items.length,
      requestEnabledCount: request.items.filter((item) => item.configuredEnabled).length,
    });
  }

  timeout(request: WorkspaceHookReviewRequestPayload): void {
    this.emit("workspace_hook.review_timeout", {
      bundleDigest: request.bundleDigest,
      generation: request.generation,
      reasonCode: "workspace_hooks_interaction_timeout",
    });
  }

  responseRejected(target: WorkspaceHookReviewTarget, reasonCode: WorkspaceHookReasonCode): void {
    this.emit(
      reasonCode === "workspace_hooks_review_superseded"
        ? "workspace_hook.stale_response"
        : "workspace_hook.snapshot_mismatch",
      { bundleDigest: target.bundleDigest, reasonCode },
    );
  }

  decisionAccepted(
    target: WorkspaceHookReviewTarget,
    decision: WorkspaceHookReviewDecision,
    counts?: { grantedRecordCount?: number; requestEnabledCount?: number },
  ): void {
    this.emit("workspace_hook.trust_selected", {
      action: decision.action,
      bundleDigest: target.bundleDigest,
      generation: target.generation,
      ...(counts?.grantedRecordCount === undefined
        ? {}
        : { grantedRecordCount: counts.grantedRecordCount }),
      ...(counts?.requestEnabledCount === undefined
        ? {}
        : { requestEnabledCount: counts.requestEnabledCount }),
    });
  }

  
  revoked(bundleDigest: string, revokedCount: number): void {
    this.emit("workspace_hook.revoked", {
      bundleDigest,
      reasonCode: "workspace_hooks_revoked",
      revokedCount,
    });
  }

  trustStoreFailure(bundleDigest: string, errorMessage?: string): void {
    this.emit("workspace_hook.trust_store_failure", {
      bundleDigest,
      reasonCode: "workspace_hooks_trust_store_corrupt",
      ...(errorMessage ? { errorMessage } : {}),
    });
  }

  toggleFailure(
    bundleDigest: string,
    reasonCode: WorkspaceHookReasonCode,
    errorMessage?: string,
  ): void {
    this.emit(
      reasonCode === "workspace_hooks_snapshot_mismatch"
        ? "workspace_hook.snapshot_mismatch"
        : reasonCode === "workspace_hooks_config_rebuild_failed"
          ? "workspace_hook.config_rebuild_failure"
          : "workspace_hook.toggle_failure",
      { bundleDigest, reasonCode, ...(errorMessage ? { errorMessage } : {}) },
    );
  }

  superseded(request: WorkspaceHookReviewRequestPayload): void {
    this.emit("workspace_hook.review_superseded", {
      bundleDigest: request.bundleDigest,
      generation: request.generation,
      reasonCode: "workspace_hooks_review_superseded",
    });
  }

  private emit(
    event: Parameters<typeof emitWorkspaceHookTelemetry>[1],
    fields: Parameters<typeof emitWorkspaceHookTelemetry>[2],
  ): void {
    emitWorkspaceHookTelemetry(this.logger, event, {
      workspaceIdentity: this.admission.getCurrentSnapshot().workspaceIdentity,
      ...fields,
    });
  }
}
