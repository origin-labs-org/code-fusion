import type { CfConfigOption } from "@origin-ai/cf-shared";
import { describe, expect, it } from "vitest";
import {
  mergeRecoveredTaskModelConfigOptions,
  mergeGlmRecoveredTaskModelConfigOptions,
  resolveTaskRestorePreloadConfigOptions,
  resolveRecoveredTaskModelValue,
  resolveGlmRecoveredTaskModelValue,
} from "@/lib/taskModelRecovery.js";
import { encodeCustomModelValue } from "@/lib/cfCustomModelValue.js";

describe("task model recovery", () => {
  it("Restores provider/model from task.meta.model to toolbar custom model value", () => {
    expect(resolveGlmRecoveredTaskModelValue("zai-api/glm-5.1")).toBe(
      encodeCustomModelValue("zai-api", "glm-5.1"),
    );
  });

  it("Non-GLM tasks use task meta model as toolbar display source during recovery", () => {
    expect(
      resolveRecoveredTaskModelValue({
        provider: "codex",
        model: "gpt-5.4",
      }),
    ).toBe("gpt-5.4");
  });

  it("Non-GLM recovery state synthesizes minimal model config from task meta even without configOptions", () => {
    const recovered = mergeRecoveredTaskModelConfigOptions({
      taskMeta: {
        provider: "codex",
        model: "gpt-5.4",
      },
      configOptions: [],
    });

    expect(recovered).toEqual([
      {
        category: "model",
        currentValue: "gpt-5.4",
        id: "model",
        name: "Model",
        options: [
          {
            name: "gpt-5.4",
            value: "gpt-5.4",
          },
        ],
        type: "select",
      },
    ]);
  });

  it("Non-GLM custom task meta uses model name as synthetic option name", () => {
    const modelValue = encodeCustomModelValue("provider-demo", "qwen-plus");
    const recovered = mergeRecoveredTaskModelConfigOptions({
      taskMeta: {
        provider: "codex",
        model: modelValue,
      },
      configOptions: [],
    });

    expect(recovered?.[0]).toEqual({
      category: "model",
      currentValue: modelValue,
      id: "model",
      name: "Model",
      options: [
        {
          name: "qwen-plus",
          value: modelValue,
        },
      ],
      type: "select",
    });
  });

  it("Non-GLM provider/model historical values use only model name for toolbar display", () => {
    const recovered = mergeRecoveredTaskModelConfigOptions({
      taskMeta: {
        provider: "codex",
        model: "36965ea6-734a-46a8-8851-3dfec026589e/glm-5.1-highspeed",
      },
      configOptions: [],
    });

    expect(recovered?.[0]).toEqual({
      category: "model",
      currentValue: "36965ea6-734a-46a8-8851-3dfec026589e/glm-5.1-highspeed",
      id: "model",
      name: "Model",
      options: [
        {
          name: "glm-5.1-highspeed",
          value: "36965ea6-734a-46a8-8851-3dfec026589e/glm-5.1-highspeed",
        },
      ],
      type: "select",
    });
  });

  it("GLM recovery state synthesizes minimal model config from task meta when configOptions is missing", () => {
    const recovered = mergeGlmRecoveredTaskModelConfigOptions({
      taskMeta: {
        provider: "glm",
        model: "provider-demo/qwen-plus",
      },
      configOptions: [],
    });

    expect(recovered).toEqual([
      {
        category: "model",
        currentValue: encodeCustomModelValue("provider-demo", "qwen-plus"),
        id: "model",
        name: "Model",
        options: [
          {
            name: "qwen-plus",
            value: encodeCustomModelValue("provider-demo", "qwen-plus"),
          },
        ],
        type: "select",
      },
    ]);
  });

  it("When model config exists, only restore current model value from GLM task meta", () => {
    const currentConfigOptions: CfConfigOption[] = [
      {
        category: "model",
        currentValue: "",
        id: "model",
        name: "Model",
        options: [{ name: "old-model", value: "old-model" }],
        type: "select",
      },
      {
        category: "mode",
        currentValue: "plan",
        id: "mode",
        name: "Mode",
        options: [{ name: "Plan", value: "plan" }],
        type: "select",
      },
    ];

    const recovered = mergeGlmRecoveredTaskModelConfigOptions({
      taskMeta: {
        provider: "glm",
        model: "provider-demo/qwen-plus",
      },
      configOptions: currentConfigOptions,
    });

    expect(recovered?.[0]).toEqual({
      category: "model",
      currentValue: encodeCustomModelValue("provider-demo", "qwen-plus"),
      id: "model",
      name: "Model",
      options: [
        { name: "old-model", value: "old-model" },
        {
          name: "qwen-plus",
          value: encodeCustomModelValue("provider-demo", "qwen-plus"),
        },
      ],
      type: "select",
    });
    expect(recovered?.[1]).toBe(currentConfigOptions[1]);
  });

  it("No new recovery config is generated when existing model config already matches task meta", () => {
    const currentModel = encodeCustomModelValue("provider-demo", "qwen-plus");
    const currentConfigOptions: CfConfigOption[] = [
      {
        category: "model",
        currentValue: currentModel,
        id: "model",
        name: "Model",
        options: [{ name: "qwen-plus", value: currentModel }],
        type: "select",
      },
    ];

    const recovered = mergeGlmRecoveredTaskModelConfigOptions({
      taskMeta: {
        provider: "glm",
        model: "provider-demo/qwen-plus",
      },
      configOptions: currentConfigOptions,
    });

    expect(recovered).toBeNull();
  });

  it("Historical task recovery prioritizes preserving task-level mode and thought_level cache", () => {
    const currentConfigOptions: CfConfigOption[] = [
      {
        category: "model",
        currentValue: "old-model",
        id: "model",
        name: "Model",
        options: [{ name: "old-model", value: "old-model" }],
        type: "select",
      },
      {
        category: "mode",
        currentValue: "yolo",
        id: "mode",
        name: "Mode",
        options: [{ name: "YOLO", value: "yolo" }],
        type: "select",
      },
      {
        category: "thought_level",
        currentValue: "max",
        id: "thought_level",
        name: "Thought",
        options: [{ name: "Max", value: "max" }],
        type: "select",
      },
    ];

    const recovered = resolveTaskRestorePreloadConfigOptions({
      taskMeta: {
        provider: "glm",
        model: "provider-demo/qwen-plus",
      },
      cachedTaskConfigOptions: currentConfigOptions,
    });

    expect(recovered.map((option) => option.category)).toEqual(["model", "mode", "thought_level"]);
    expect(recovered[0]?.currentValue).toBe(encodeCustomModelValue("provider-demo", "qwen-plus"));
    expect(recovered[1]).toBe(currentConfigOptions[1]);
    expect(recovered[2]).toBe(currentConfigOptions[2]);
  });

  it("Existing task config cache is not cleared when historical task meta is temporarily missing model", () => {
    const currentConfigOptions: CfConfigOption[] = [
      {
        category: "mode",
        currentValue: "yolo",
        id: "mode",
        name: "Mode",
        options: [{ name: "YOLO", value: "yolo" }],
        type: "select",
      },
    ];

    const recovered = resolveTaskRestorePreloadConfigOptions({
      taskMeta: {
        provider: "glm",
        model: undefined,
      },
      cachedTaskConfigOptions: currentConfigOptions,
    });

    expect(recovered).toEqual(currentConfigOptions);
    expect(recovered).not.toBe(currentConfigOptions);
  });

  it("非 GLM task 不使用该兜底来源", () => {
    expect(
      mergeGlmRecoveredTaskModelConfigOptions({
        taskMeta: {
          provider: "codex",
          model: "provider-demo/gpt-5.4",
        },
        configOptions: [],
      }),
    ).toBeNull();
  });

  it("synthetic 模型占位不会被合成成历史恢复模型", () => {
    expect(
      mergeRecoveredTaskModelConfigOptions({
        taskMeta: {
          provider: "claude",
          model: "<synthetic>",
        },
        configOptions: [],
      }),
    ).toBeNull();
  });
});
