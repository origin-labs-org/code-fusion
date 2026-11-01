import { describe, expect, it } from "vitest";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@origin-ai/cf-shared";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";
import {
  resolveV4ModelTriggerDisplay,
  resolveV4ModelTriggerLabel,
} from "@/v4/composer/modelTriggerDisplay.js";

function createGroup({
  key,
  label,
  labelBadge,
  modelName,
}: {
  key: string;
  label: string;
  labelBadge?: string;
  modelName: string;
}): ModelSelectGroup {
  return {
    key,
    label,
    labelBadge,
    items: [
      {
        key: `${key}:${modelName}`,
        value: `custom:${key}:${modelName}`,
        name: modelName,
      },
    ],
  };
}

describe("resolveV4ModelTriggerLabel", () => {
  it("供应商Name缺失时使用 providerId andExactHit的ModelName", () => {
    const group = createGroup({
      key: "dev-model",
      label: "devModel",
      modelName: "glm-5.2",
    });

    expect(
      resolveV4ModelTriggerLabel({
        modelGroups: [group],
        normalizedValue: "custom:dev-model:glm-5.2",
        fallbackLabel: "glm-4.7",
        providerId: "dev-model",
      }),
    ).toBe("dev-model/glm-5.2");
  });

  it.each([
    [BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan, "Z.ai - Coding Plan"],
    [BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan, "Z.ai - Start Plan"],
    [BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan, "BigModel - Coding Plan"],
    [BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan, "BigModel - Start Plan"],
  ])("%s Built-in供应商只ShowModel名", (providerId, providerName) => {
    const group = createGroup({
      key: providerId,
      label: providerName,
      modelName: "GLM-5.2",
    });

    expect(
      resolveV4ModelTriggerLabel({
        modelGroups: [group],
        normalizedValue: `custom:${providerId}:GLM-5.2`,
        fallbackLabel: "选择模型",
        providerId,
        providerName,
      }),
    ).toBe("GLM-5.2");
  });

  it("DeepSeek Custom Provider Collapse后Show providerName/modelName", () => {
    const group = createGroup({
      key: "default-deepseek",
      label: "deepseek",
      modelName: "deepseek-v4-flash",
    });

    expect(
      resolveV4ModelTriggerLabel({
        modelGroups: [group],
        normalizedValue: "custom:default-deepseek:deepseek-v4-flash",
        fallbackLabel: "选择模型",
        providerId: "default-deepseek",
        providerName: "deepseek",
      }),
    ).toBe("deepseek/deepseek-v4-flash");
  });

  it("Current编码ValueInvalid时使用既有占位回落", () => {
    expect(
      resolveV4ModelTriggerLabel({
        modelGroups: [],
        normalizedValue: "custom:missing:glm-5.2",
        fallbackLabel: "选择模型",
        providerId: "missing",
      }),
    ).toBe("选择模型");
  });
});

describe("resolveV4ModelTriggerDisplay", () => {
  it.each([undefined, "", "   "])(
    "Name为 %s 时以 providerId RetainComplete身份andPrefix",
    (providerName) => {
      const group = createGroup({
        key: "bigmodel-api",
        label: "bigmodel-api",
        modelName: "GLM-5.3",
      });
      expect(
        resolveV4ModelTriggerDisplay({
          modelGroups: [group],
          normalizedValue: "custom:bigmodel-api:GLM-5.3",
          fallbackLabel: "选择模型",
          providerId: "bigmodel-api",
          providerName,
        }),
      ).toEqual({
        fullLabel: "bigmodel-api/GLM-5.3",
        providerPrefix: "bigmodel-api/",
        modelLabel: "GLM-5.3",
      });
    },
  );

  it("RetainComplete身份并把Custom providersPrefix拆成响应式展示节点", () => {
    const group = createGroup({
      key: "default-deepseek",
      label: "deepseek",
      modelName: "deepseek-v4-flash",
    });

    expect(
      resolveV4ModelTriggerDisplay({
        modelGroups: [group],
        normalizedValue: "custom:default-deepseek:deepseek-v4-flash",
        fallbackLabel: "选择模型",
        providerId: "default-deepseek",
        providerName: "deepseek",
      }),
    ).toEqual({
      fullLabel: "deepseek/deepseek-v4-flash",
      providerPrefix: "deepseek/",
      modelLabel: "deepseek-v4-flash",
    });
  });

  it("Built-in供应商没有可Hide的 provider Prefix", () => {
    const group = createGroup({
      key: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      label: "Z.ai - Coding Plan",
      modelName: "GLM-5.2",
    });

    expect(
      resolveV4ModelTriggerDisplay({
        modelGroups: [group],
        normalizedValue: `custom:${BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan}:GLM-5.2`,
        fallbackLabel: "选择模型",
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        providerName: "Z.ai - Coding Plan",
      }),
    ).toEqual({
      fullLabel: "GLM-5.2",
      modelLabel: "GLM-5.2",
    });
  });
});
