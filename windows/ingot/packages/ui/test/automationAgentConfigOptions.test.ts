import { describe, expect, it } from "vitest";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@origin-ai/cf-shared";
import {
  buildAutomationModelSelectGroups,
  buildAutomationModelSelection,
  buildAutomationModeOption,
  buildAutomationThoughtLevelOption,
  resolveAutomationPreferredModelValue,
  resolveAutomationModelItem,
  resolveAutomationModelTriggerLabel,
  resolveAutomationThoughtLevelUpdate,
} from "@/settings/automationAgentConfigOptions.js";
import { encodeCustomModelValue } from "@/lib/cfCustomModelValue.js";

const groups: ModelSelectGroup[] = [
  {
    key: "provider:demo",
    label: "Demo",
    items: [
      {
        key: "provider:demo:model-a",
        value: encodeCustomModelValue("demo", "model-a"),
        name: "model-a",
      },
      {
        key: "provider:demo:model-b",
        value: encodeCustomModelValue("demo", "model-b"),
        name: "model-b",
      },
    ],
  },
];

describe("automation model/thought linkage", () => {
  it("New task initializes Host preferredSelection to a specific model identity", () => {
    expect(
      resolveAutomationPreferredModelValue({
        revision: 2,
        preferredSelection: { providerId: "demo", modelId: "model-b" },
        providers: [],
      }),
    ).toBe(encodeCustomModelValue("demo", "model-b"));
  });

  it("Host 没有 preferredSelection 时不伪造默认模型", () => {
    expect(resolveAutomationPreferredModelValue({ revision: 2, providers: [] })).toBeNull();
  });
  it("Do not redo entitlement filtering with old Provider when Registry View is published", () => {
    expect(
      buildAutomationModelSelectGroups({
        selectedProvider: "glm",
        labels: {},
        registrySelectionView: { revision: 1, providers: [] },
      }),
    ).toEqual([]);
  });

  it("New task model list directly uses the resolved model set from Registry", () => {
    const groups = buildAutomationModelSelectGroups({
      selectedProvider: "glm",
      labels: {},
      registrySelectionView: {
        revision: 1,
        providers: [
          {
            providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
            providerName: "BigModel Coding",
            config: {
              access: {
                type: "zhipu-account",
              },
              api: {
                type: "anthropic-messages",
                baseUrl: "https://open.bigmodel.cn/api/anthropic",
              },
              models: ["coding-only-model"],
            },
            models: [{ modelId: "coding-only-model", config: {} }],
          },
        ],
      },
    });

    expect(groups.flatMap((group) => group.items.map((item) => item.name))).toEqual([
      "coding-only-model",
    ]);
  });

  it("Use current candidate level, but leave invalid old value empty instead of using preview default", () => {
    const option = buildAutomationThoughtLevelOption(
      {
        id: "thought_level",
        name: "Thought Level",
        category: "thought_level",
        type: "select",
        currentValue: "high",
        options: [
          { value: "minimal", name: "Minimal" },
          { value: "high", name: "High" },
        ],
      },
      "medium",
    );

    expect(option?.currentValue).toBe("");
    expect(option?.options?.map((item) => item.value)).toEqual(["minimal", "high"]);
  });

  it("Compatible with provider/model values saved by tasks created within session", () => {
    expect(resolveAutomationModelItem(groups, "demo/model-a")?.name).toBe("model-a");
  });

  it("模型触发器从 Registry View 显示 providerName/modelName", () => {
    expect(
      resolveAutomationModelTriggerLabel({
        modelGroups: groups,
        modelSelectionView: {
          revision: 1,
          providers: [
            {
              providerId: "demo",
              providerName: "Demo Provider",
              config: {},
              models: [{ modelId: "model-a", config: {} }],
            },
          ],
        },
        modelValue: "demo/model-a",
        fallbackLabel: "选择模型",
      }),
    ).toBe("Demo Provider/model-a");
  });

  it("Model trigger continues to follow session-side built-in family clipping rules", () => {
    const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
    const modelGroups: ModelSelectGroup[] = [
      {
        key: `provider:${providerId}`,
        label: "BigModel Coding Plan",
        items: [
          {
            key: `provider:${providerId}:glm-5.2`,
            value: encodeCustomModelValue(providerId, "glm-5.2"),
            name: "glm-5.2",
          },
        ],
      },
    ];

    expect(
      resolveAutomationModelTriggerLabel({
        modelGroups,
        modelValue: encodeCustomModelValue(providerId, "glm-5.2"),
        fallbackLabel: "选择模型",
      }),
    ).toBe("glm-5.2");
  });

  it("已保存模型不在当前候选中时仍回显模型名", () => {
    const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
    const staleModel = encodeCustomModelValue(providerId, "glm-5.2");

    expect(
      resolveAutomationModelTriggerLabel({
        modelGroups: [],
        modelValue: staleModel,
        fallbackLabel: "选择模型",
      }),
    ).toBe("glm-5.2");
  });

  it("runtime provider 包装值只在模型名唯一时映射回菜单项", () => {
    expect(resolveAutomationModelItem(groups, "cf-openai-compatible/model-a")?.value).toBe(
      encodeCustomModelValue("demo", "model-a"),
    );
  });

  it("Retain user selection when current value remains valid", () => {
    const option = buildAutomationThoughtLevelOption(
      {
        id: "thought_level",
        name: "Thought Level",
        category: "thought_level",
        type: "select",
        currentValue: "medium",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
        ],
      },
      "high",
    );

    expect(option?.currentValue).toBe("high");
    expect(option?.options?.map((item) => item.value)).toEqual(["low", "medium", "high"]);
  });

  it("Leave empty when there is no specific level, do not default to highest level", () => {
    const option = buildAutomationThoughtLevelOption(
      {
        id: "thought_level",
        name: "Thought Level",
        category: "thought_level",
        type: "select",
        options: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
          { value: "max", name: "Max" },
        ],
      },
      "",
    );

    expect(option?.currentValue).toBe("");
  });

  it.each(["edit", "guarded", "yolo"])(
    "Edit-state permission %s displayed as-is; menu uses guarded instead of edit",
    (mode) => {
      const option = buildAutomationModeOption(mode);

      expect(option.currentValue).toBe(mode);
      expect(option.options?.map((item) => item.value)).toEqual([
        "build",
        "guarded",
        "plan",
        "yolo",
      ]);
    },
  );

  it("ModelSelection only saves model identity and reasoning, without inheriting old output budget", () => {
    const previous = {
      providerId: "provider-a",
      modelId: "model-a",
      options: { reasoningLevel: "low", maxOutputTokens: 12_000 },
    } as const;
    expect(
      buildAutomationModelSelection({
        selected: { providerId: "provider-a", modelId: "model-a" },
        reasoningLevel: "high",
        previous,
      }),
    ).toEqual({
      providerId: "provider-a",
      modelId: "model-a",
      options: { reasoningLevel: "high" },
    });
    expect(
      buildAutomationModelSelection({
        selected: { providerId: "provider-b", modelId: "model-b" },
        previous,
      }),
    ).toEqual({ providerId: "provider-b", modelId: "model-b" });
  });

  it("Explicitly clear old level when switching to non-Think model during edit", () => {
    expect(
      resolveAutomationThoughtLevelUpdate({
        editing: true,
        explicitlyChanged: false,
        modelChanged: true,
        resolvedThoughtLevel: "",
        thoughtLevel: "max",
      }),
    ).toBeNull();
  });

  it("Do not write thoughtLevel for non-Think models in new tasks", () => {
    expect(
      resolveAutomationThoughtLevelUpdate({
        editing: false,
        explicitlyChanged: false,
        modelChanged: true,
        resolvedThoughtLevel: "",
        thoughtLevel: "max",
      }),
    ).toBeUndefined();
  });

  it("Persist target model\'s current level to scheduled task", () => {
    expect(
      resolveAutomationThoughtLevelUpdate({
        editing: false,
        explicitlyChanged: false,
        modelChanged: true,
        resolvedThoughtLevel: "high",
        thoughtLevel: "high",
      }),
    ).toBe("high");
  });

  it("Still save pin when user explicitly selects level identical to default", () => {
    expect(
      resolveAutomationThoughtLevelUpdate({
        editing: false,
        explicitlyChanged: true,
        modelChanged: true,
        resolvedThoughtLevel: "high",
        thoughtLevel: "high",
      }),
    ).toBe("high");
  });

  it("Retain existing explicit pin when edit does not touch model and level", () => {
    expect(
      resolveAutomationThoughtLevelUpdate({
        editing: true,
        explicitlyChanged: false,
        modelChanged: false,
        persistedReasoningLevel: "max",
        resolvedThoughtLevel: "max",
        thoughtLevel: "max",
      }),
    ).toBe("max");
  });
});
