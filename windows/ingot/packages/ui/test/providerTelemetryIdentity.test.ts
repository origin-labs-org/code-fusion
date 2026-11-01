import { describe, expect, it, vi } from "vitest";
import { encodeCustomModelValue, type CfAutomation } from "@origin-ai/cf-shared";
import {
  buildV4ConversationPromptTelemetryExtraDetail,
  resolveLegacyRuntimeModelValue,
} from "@/v4/telemetry/conversationPromptTelemetry.js";
import {
  resolveAutomationSelectionTelemetry,
  reportAutomationActionClick,
  reportAutomationCreateResult,
} from "@/lib/automationTelemetry.js";
import { freezeOffPeakCreateTelemetrySnapshot } from "@/lib/offPeakTelemetry.js";
import { buildCompactionTelemetryExtraDetail } from "@/lib/messageTelemetry.js";

const identities = [
  ["zai-api", "builtin:zai"],
  ["bigmodel-api", "builtin:bigmodel"],
  ...["zai", "bigmodel"].flatMap((family) => [
    [`account:${family}-individual-coding-plan`, `builtin:${family}-coding-plan`],
    [`account:${family}-team-coding-plan`, `builtin:${family}-coding-plan`],
    [`account:${family}-start-plan`, `builtin:${family}-start-plan`],
    [`account:${family}-offpeak-idle-plan`, "offpeak-idle-plan"],
  ]),
  ["personal-uuid", "personal-uuid"],
  ["builtin:zai-coding-plan", "builtin:zai-coding-plan"],
  ["account:future-plan", "account:future-plan"],
];

describe("Legacy metrics standard for Provider tracking", () => {
  it.each(["zai", "bigmodel"])(
    "%s automated success/failure/run immediately actual reports share the same bucket, keeping model as pure ID",
    async (family) => {
      const platform = { reportTelemetryEvent: vi.fn(async () => {}) };
      const modelSelection = {
        providerId: `account:${family}-team-coding-plan`,
        modelId: "vendor/model:1%",
      };
      const modelFields = resolveAutomationSelectionTelemetry(modelSelection, null);
      await reportAutomationCreateResult(platform, {
        automationId: "automation",
        cronExpr: "0 * * * *",
        modelFields,
      });
      await reportAutomationCreateResult(platform, {
        error: "failed",
        cronExpr: "0 * * * *",
        modelFields,
      });
      await reportAutomationActionClick(platform, {
        action: "run_now",
        source: "list",
        automation: { automationId: "automation", modelSelection } as CfAutomation,
        providerSettingsView: null,
      });
      expect(platform.reportTelemetryEvent).toHaveBeenCalledTimes(3);
      for (const [payload] of platform.reportTelemetryEvent.mock.calls) {
        expect(payload.eventExtraDetail).toMatchObject({
          model_provider: `builtin:${family}-coding-plan`,
          model_name: modelSelection.modelId,
          provider_name: "",
        });
      }
    },
  );
  it.each(identities)("%s → %s，模型 ID 无损且选择不变", (providerId, legacy) => {
    const modelId = "vendor/a:b%2F模型";
    const selection = Object.freeze({ providerId, modelId });
    const send = buildV4ConversationPromptTelemetryExtraDetail({
      configProvider: providerId,
      modelName: modelId,
    });
    expect(send.model_provider).toBe(legacy);
    expect(send.model_name).toBe(encodeCustomModelValue(legacy, modelId));
    expect(resolveLegacyRuntimeModelValue({ configProvider: providerId, modelName: modelId })).toBe(
      `${legacy}/${modelId}`,
    );
    expect(resolveAutomationSelectionTelemetry(selection, null)).toEqual({
      model_provider: legacy,
      model_name: modelId,
      provider_name: "",
    });
    expect(selection).toEqual({ providerId, modelId });
  });
  it.each(["zai", "bigmodel"])("%s freezes legacy bucket when idle, pure model value unchanged", (family) => {
    expect(
      freezeOffPeakCreateTelemetrySnapshot({
        providerId: `account:${family}-offpeak-idle-plan`,
        model: "GLM-5.3-Flash",
      }),
    ).toMatchObject({ modelProvider: "offpeak-idle-plan", modelName: "GLM-5.3-Flash" });
  });
  it("Compression preserves original model format without adding hostname", () => {
    const detail = buildCompactionTelemetryExtraDetail({
      timeline: { status: "completed", trigger: "manual" },
      modelName: "account:bigmodel-team-coding-plan/GLM-5.3",
      modelProvider: "account:bigmodel-team-coding-plan",
    });
    expect(detail).toMatchObject({
      model_name: "builtin:bigmodel-coding-plan/GLM-5.3",
      model_provider: "builtin:bigmodel-coding-plan",
    });
    expect(detail).not.toHaveProperty("provider_name");
  });
});
