
export function didWorkspaceHookReviewSettle(input: {
  previousInteractionId: string | undefined;
  currentInteractionId: string | undefined;
}): boolean {
  return input.previousInteractionId !== undefined && input.currentInteractionId === undefined;
}

const WORKSPACE_HOOK_REASON_CODE_MESSAGE_IDS: Record<string, string> = {
  workspace_hooks_review_superseded: "settings.hooks.review.reason.review_superseded",
  workspace_hooks_snapshot_mismatch: "settings.hooks.review.reason.snapshot_mismatch",
  workspace_hooks_bundle_changed: "settings.hooks.review.reason.bundle_changed",
  workspace_hooks_config_unreadable: "settings.hooks.review.reason.config_unreadable",
  workspace_hooks_config_write_failed: "settings.hooks.review.reason.config_write_failed",
  workspace_hooks_config_rebuild_failed: "settings.hooks.review.reason.config_rebuild_failed",
  workspace_hooks_trust_store_corrupt: "settings.hooks.review.reason.trust_store_corrupt",
  workspace_hooks_blocked_by_policy: "settings.hooks.review.reason.blocked_by_policy",
  workspace_hooks_policy_requires_pretrust: "settings.hooks.review.reason.policy_requires_pretrust",
  workspace_hooks_interaction_timeout: "settings.hooks.review.reason.interaction_timeout",
  workspace_hooks_require_trust_capable_host: "settings.hooks.review.reason.host_unavailable",
};

const WORKSPACE_HOOK_REASON_CODE_FALLBACK_ID = "settings.hooks.review.reason.rejected";

export function resolveWorkspaceHookReasonCodeMessageId(reasonCode: string | undefined): string {
  if (!reasonCode) return WORKSPACE_HOOK_REASON_CODE_FALLBACK_ID;
  return (
    WORKSPACE_HOOK_REASON_CODE_MESSAGE_IDS[reasonCode] ?? WORKSPACE_HOOK_REASON_CODE_FALLBACK_ID
  );
}

export function shouldSilenceStaleRejection(input: {
  reasonCode: string | undefined;
  hasLivePendingBinding: boolean;
}): boolean {
  if (input.reasonCode !== "workspace_hooks_review_superseded") return false;
  return !input.hasLivePendingBinding;
}
