import { BUILTIN_MODEL_PROVIDER_IDS, type UsageEntitlementSnapshot } from "@origin-ai/cf-shared";
import { describe, expect, it } from "vitest";
import {
  buildSessionQuotaBannerDismissKey,
  buildSessionQuotaBannerState,
  normalizeProviderLimitedBannerMessage,
  resolveQuotaBannerUpgradeProviderId,
  shouldOfferQuotaBannerUpgrade,
} from "@/v4/sessionQuotaBannerState.js";
import { resolveMcpUnavailableNotice } from "@/v4/mcpUnavailableBannerNotice.js";
import type { ConversationRow } from "@origin-ai/cf-shared/cf-protocol-v4";

function entitlement(params: {
  dailyRemaining: number;
  modelRemaining: number;
}): UsageEntitlementSnapshot {
  return {
    generatedAt: 1,
    authenticated: true,
    provider: {
      id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      name: "Z.AI Start Plan",
    },
    remaining: {
      count: params.dailyRemaining,
      isShow: true,
      percentage: params.dailyRemaining / 500,
    },
    subscription: null,
    quota: {
      level: "Start",
      limits: [
        {
          type: "glm-5.2",
          bucketId: "bucket-glm-52",
          periodStart: 0,
          periodEnd: 1000,
          number: 100,
          remaining: params.modelRemaining,
          percentage: params.modelRemaining / 100,
          usageDetails: [{ modelCode: "glm-5.2", usage: 100 - params.modelRemaining }],
        },
      ],
    },
  };
}

describe("V4 session quota banner state", () => {
  it("只Retain 10% and耗尽提醒，且不阻断Submit", () => {
    const cases = [
      [50, null, false],
      [48, null, false],
      [47, null, false],
      [20, null, false],
      [10.1, null, false],
      [10, "model-very-low", true],
      [9, "model-very-low", true],
      [0, "daily-exhausted", false],
    ] as const;
    for (const [remaining, kind, dismissible] of cases) {
      const state = buildSessionQuotaBannerState({
        activeProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        snapshot: entitlement({
          dailyRemaining: 450,
          modelRemaining: remaining,
        }),
        modelId: "glm-5.2",
      });
      expect(state.kind).toBe(kind);
      expect(state.dismissible).toBe(dismissible);
      expect(state.blocksSubmit).toBe(false);
    }
  });

  it("Service端Concurrencyand额度Error优先于 entitlement，dismiss key IsolatedErrorInstance", () => {
    const state = buildSessionQuotaBannerState({
      activeProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      snapshot: entitlement({ dailyRemaining: 450, modelRemaining: 50 }),
      modelId: "glm-5.2",
      serverConcurrentLimited: true,
      serverConcurrentLimitBusinessCode: "3010",
      serverConcurrentLimitReason: "retry-exhausted-busy",
    });
    expect(state.kind).toBe("concurrent-limit");
    expect(state.priority).toBe(60);
    expect(buildSessionQuotaBannerDismissKey(state, "error-a")).not.toBe(
      buildSessionQuotaBannerDismissKey(state, "error-b"),
    );
  });

  it("Official MCP Unavailable时按 code 分流，且不阻断Input", () => {
    const quotaState = buildSessionQuotaBannerState({
      activeProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      snapshot: null,
      modelId: "glm-5.2",
      mcpUnavailableNotice: {
        code: "quota_exceeded",
        rowId: 12,
        serverName: "cf-official",
        toolName: "search_image",
      },
    });
    expect(quotaState.kind).toBe("mcp-quota-exhausted");
    expect(quotaState.mcpServerName).toBe("cf-official");
    expect(quotaState.dismissible).toBe(true);
    expect(quotaState.blocksSubmit).toBe(false);

    const planState = buildSessionQuotaBannerState({
      activeProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      snapshot: null,
      modelId: "glm-5.2",
      mcpUnavailableNotice: {
        code: "coding_plan_required",
        rowId: 12,
        serverName: "cf-official",
        toolName: "search_image",
      },
    });
    expect(planState.kind).toBe("mcp-plan-required");
  });

  it("今日额度用完不ToUpgrade入口，Entitlements缺失才To", () => {
    expect(shouldOfferQuotaBannerUpgrade("mcp-quota-exhausted")).toBe(false);
    expect(shouldOfferQuotaBannerUpgrade("mcp-plan-required")).toBe(true);
    expect(shouldOfferQuotaBannerUpgrade("daily-exhausted")).toBe(true);
    expect(shouldOfferQuotaBannerUpgrade("provider-limited")).toBe(true);
    expect(shouldOfferQuotaBannerUpgrade(null)).toBe(true);
  });

  it("Model额度Issue优先于 MCP Notice", () => {
    const state = buildSessionQuotaBannerState({
      activeProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      snapshot: entitlement({ dailyRemaining: 0, modelRemaining: 0 }),
      modelId: "glm-5.2",
      serverQuotaExhausted: true,
      mcpUnavailableNotice: {
        code: "quota_exceeded",
        rowId: 12,
        serverName: "cf-official",
        toolName: "search_image",
      },
    });
    expect(state.kind).toBe("daily-exhausted");
    expect(state.priority).toBeGreaterThan(8);
  });

  it("MCP Notice的 dismiss key Follow server 与具体调用", () => {
    const build = (rowId: number, serverName: string) =>
      buildSessionQuotaBannerDismissKey(
        buildSessionQuotaBannerState({
          activeProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
          snapshot: null,
          modelId: "glm-5.2",
          mcpUnavailableNotice: {
            code: "quota_exceeded",
            rowId,
            serverName,
            toolName: "search_image",
          },
        }),
      );
    expect(build(12, "cf-official")).toBe(build(12, "cf-official"));
    expect(build(12, "cf-official")).not.toBe(build(13, "cf-official"));
    expect(build(12, "cf-official")).not.toBe(build(12, "cf-video-edit"));
  });

  it("从 rows 里取最NewOne条带Label识的Official MCP 调用", () => {
    const toolRow = (rowId: number, unavailable?: { code: "quota_exceeded" }): ConversationRow =>
      ({
        rowId,
        turnId: "t1",
        kind: "toolCall",
        toolCallId: `call-${rowId}`,
        toolName: "mcp__cf-official__search_image",
        status: "success",
        inputText: "{}",
        display: {
          kind: "mcp_tool",
          serverName: "cf-official",
          toolName: "search_image",
          ...(unavailable ? { unavailable } : {}),
        },
      }) as unknown as ConversationRow;

    expect(resolveMcpUnavailableNotice(undefined)).toBeNull();
    expect(resolveMcpUnavailableNotice([toolRow(1)])).toBeNull();
    expect(
      resolveMcpUnavailableNotice([
        toolRow(1, { code: "quota_exceeded" }),
        toolRow(2),
        toolRow(3, { code: "quota_exceeded" }),
      ]),
    ).toEqual({
      code: "quota_exceeded",
      rowId: 3,
      serverName: "cf-official",
      toolName: "search_image",
    });
  });

  it("同One MCP Tools的New成功调用覆盖OldFailed，OtherToolsFailed不受影响", () => {
    const toolRow = (
      rowId: number,
      serverName: string,
      toolName: string,
      unavailable?: { code: "quota_exceeded" },
    ): ConversationRow =>
      ({
        rowId,
        turnId: "t1",
        kind: "toolCall",
        toolCallId: `call-${rowId}`,
        toolName: `mcp__${serverName}__${toolName}`,
        status: "success",
        inputText: "{}",
        display: {
          kind: "mcp_tool",
          serverName,
          toolName,
          ...(unavailable ? { unavailable } : {}),
        },
      }) as unknown as ConversationRow;

    expect(
      resolveMcpUnavailableNotice([
        toolRow(1, "official", "search_image", { code: "quota_exceeded" }),
        toolRow(2, "official", "search_image"),
      ]),
    ).toBeNull();
    expect(
      resolveMcpUnavailableNotice([
        toolRow(1, "official", "search_image", { code: "quota_exceeded" }),
        toolRow(2, "official", "speech_synthesize"),
      ]),
    ).toMatchObject({ rowId: 1, toolName: "search_image" });
  });

  it("清洗 GLM bracket Copy并RetainCurrent Provider 身份", () => {
    expect(
      normalizeProviderLimitedBannerMessage("[1113][Insufficient balanceor无Available资源包,请充Value。][request-id]"),
    ).toBe("Insufficient balanceor无Available资源包,请充Value。");
    expect(
      resolveQuotaBannerUpgradeProviderId(BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan),
    ).toBe(BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan);
  });
});
