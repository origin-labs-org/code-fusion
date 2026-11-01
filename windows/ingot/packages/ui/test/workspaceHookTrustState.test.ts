import { describe, expect, it } from "vitest";
import {
  didWorkspaceHookReviewSettle,
  resolveWorkspaceHookReasonCodeMessageId,
  shouldSilenceStaleRejection,
} from "../src/settings/workspaceHookTrustState.js";
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";

describe("workspace Hook trust state 展示语义（D19）", () => {
  it("只在「有 review → 无 review」跃变时Triage审核End结", () => {
    expect(
      didWorkspaceHookReviewSettle({
        previousInteractionId: "interaction-1",
        currentInteractionId: undefined,
      }),
    ).toBe(true);

    expect(
      didWorkspaceHookReviewSettle({
        previousInteractionId: undefined,
        currentInteractionId: undefined,
      }),
    ).toBe(false);

    expect(
      didWorkspaceHookReviewSettle({
        previousInteractionId: undefined,
        currentInteractionId: "interaction-1",
      }),
    ).toBe(false);
    expect(
      didWorkspaceHookReviewSettle({
        previousInteractionId: "interaction-1",
        currentInteractionId: "interaction-2",
      }),
    ).toBe(false);
  });

  it("reasonCode 映射到非空 i18n key，Unknown码回退到通用DenyCopy而非Raw码", () => {
    const knownCodes = [
      "workspace_hooks_review_superseded",
      "workspace_hooks_snapshot_mismatch",
      "workspace_hooks_bundle_changed",
      "workspace_hooks_config_unreadable",
      "workspace_hooks_config_write_failed",
      "workspace_hooks_config_rebuild_failed",
      "workspace_hooks_trust_store_corrupt",
      "workspace_hooks_blocked_by_policy",
      "workspace_hooks_policy_requires_pretrust",
      "workspace_hooks_interaction_timeout",
      "workspace_hooks_require_trust_capable_host",
    ];

    for (const code of knownCodes) {
      const id = resolveWorkspaceHookReasonCodeMessageId(code);
      expect(id, `${code} 应映射到非Empty key`).toBeTruthy();
      expect(id, `${code} 不得回退为Raw码`).not.toBe(code);
      expect(zhCN[id], `zh-CN 缺 ${id}`).toBeTruthy();
      expect(enUS[id], `en-US 缺 ${id}`).toBeTruthy();
    }

    const fallback = resolveWorkspaceHookReasonCodeMessageId("totally_unknown_code");
    expect(fallback).toBe("settings.hooks.review.reason.rejected");
    expect(fallback).not.toBe("totally_unknown_code");
    expect(zhCN[fallback]).toBeTruthy();
    expect(enUS[fallback]).toBeTruthy();

    expect(resolveWorkspaceHookReasonCodeMessageId(undefined)).toBe(
      "settings.hooks.review.reason.rejected",
    );
  });
});

describe("双击 stale superseded 静默收敛（#9）", () => {
  it("superseded + Local已无 live pending binding（双击Second time）⇒ 静默", () => {
    expect(
      shouldSilenceStaleRejection({
        reasonCode: "workspace_hooks_review_superseded",
        hasLivePendingBinding: false,
      }),
    ).toBe(true);
  });

  it("superseded + Local仍有 live pending binding（bundle Changes等真正 supersede）⇒ 展示", () => {
    expect(
      shouldSilenceStaleRejection({
        reasonCode: "workspace_hooks_review_superseded",
        hasLivePendingBinding: true,
      }),
    ).toBe(false);
  });

  it("非 superseded 的 rejection One律展示，不论 binding Status", () => {
    for (const reasonCode of [
      "workspace_hooks_snapshot_mismatch",
      "workspace_hooks_blocked_by_policy",
      "workspace_hooks_bundle_changed",
      undefined,
    ]) {
      expect(
        shouldSilenceStaleRejection({
          reasonCode,
          hasLivePendingBinding: false,
        }),
      ).toBe(false);
      expect(
        shouldSilenceStaleRejection({
          reasonCode,
          hasLivePendingBinding: true,
        }),
      ).toBe(false);
    }
  });
});
