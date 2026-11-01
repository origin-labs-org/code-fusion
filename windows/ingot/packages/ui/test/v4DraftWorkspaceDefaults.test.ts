import { describe, expect, it } from "vitest";
import type { ModelSelectionView } from "@origin-ai/cf-services";
import {
  resolveDraftDisplayedConfig,
  resolveDraftModelThoughtOption,
  resolveDraftThoughtCurrentValue,
} from "@/v4/composer/draftWorkspaceDefaults.js";
import {
  applyDraftModelSelection,
  buildDraftCreateConfigPayload,
  shouldHydrateWorkspaceCatalog,
} from "@/v4/composer/useDraftConfigControl.js";

describe("resolveDraftDisplayedConfig", () => {
  it("Tools条只投影 Composer 的Structures化选择", () => {
    expect(
      resolveDraftDisplayedConfig({
        modelSelection: { providerId: "glm", modelId: "GLM-5.2" },
      }),
    ).toEqual({
      modelSelection: { providerId: "glm", modelId: "GLM-5.2" },
      provider: "glm",
      model: "GLM-5.2",
      thought: "",
      thoughtLevels: [],
      followupMode: "queue",
      mode: "build",
    });
  });

  it("同Model的Old Session 档位也不能补齐 Composer 留空的档位", () => {
    expect(
      resolveDraftDisplayedConfig({
        modelSelection: { providerId: "glm", modelId: "GLM-5.2" },
        thought: "medium",
      })?.thought,
    ).toBe("");
  });

  it("Composer Model留空时不能恢复 Session Model", () => {
    expect(
      resolveDraftDisplayedConfig({
        provider: "glm",
        model: "GLM-5-Turbo",
        mode: "yolo",
        modelSelection: undefined,
      }),
    ).toBeNull();
  });

  it("ShowStructures化选择的档位，不看平铺OldValue", () => {
    expect(
      resolveDraftDisplayedConfig({
        thought: "medium",
        modelSelection: {
          providerId: "glm",
          modelId: "GLM-5.2",
          options: { reasoningLevel: "low" },
        },
      })?.thought,
    ).toBe("low");
  });
});

describe("resolveDraftModelThoughtOption", () => {
  const modelSelectionView: ModelSelectionView = {
    revision: 1,
    providers: [
      {
        providerId: "glm",
        providerName: "GLM",
        config: {},
        models: [
          {
            modelId: "GLM-5.2",
            config: {
              optionSpecs: {
                reasoningLevel: {
                  values: ["low", "medium", "high"],
                  map: "{}",
                },
                maxOutputTokens: { max: 32_000, map: "{}" },
              },
            },
          },
          {
            modelId: "GLM-5-Turbo",
            config: {
              optionSpecs: {
                reasoningLevel: { values: ["disabled"], map: "{}" },
                maxOutputTokens: { max: 32_000, map: "{}" },
              },
            },
          },
          {
            modelId: "glm-5.2-pro",
            config: {
              optionSpecs: {
                reasoningLevel: { values: ["disabled"], map: "{}" },
                maxOutputTokens: { max: 32_000, map: "{}" },
              },
            },
          },
        ],
      },
    ],
  };

  it("returns the selected model's own levels without inventing a reasoning value", () => {
    expect(resolveDraftModelThoughtOption("glm", "GLM-5.2", modelSelectionView)).toMatchObject({
      currentValue: "",
      options: [{ value: "low" }, { value: "medium" }, { value: "high" }],
    });
  });

  it("does not fall back to another model's thought capabilities", () => {
    expect(resolveDraftModelThoughtOption("glm", "unknown", modelSelectionView)).toBeNull();
  });

  it("does not infer reasoning from the GLM model name", () => {
    expect(resolveDraftModelThoughtOption("glm", "glm-5.2-pro", modelSelectionView)).toMatchObject({
      currentValue: "",
      options: [{ value: "disabled" }],
    });
  });

  it("uses the Registry model option spec", () => {
    const updatedSelectionView: ModelSelectionView = {
      revision: 2,
      providers: [
        {
          providerId: "glm",
          providerName: "GLM",
          config: {},
          models: [
            {
              modelId: "GLM-5.2",
              config: {
                optionSpecs: {
                  reasoningLevel: {
                    values: ["high", "max"],
                    map: "{}",
                  },
                  maxOutputTokens: { max: 32_000, map: "{}" },
                },
              },
            },
          ],
        },
      ],
    };

    expect(resolveDraftModelThoughtOption("glm", "GLM-5.2", updatedSelectionView)).toMatchObject({
      currentValue: "",
      options: [{ value: "high" }, { value: "max" }],
    });
  });
});

describe("resolveDraftThoughtCurrentValue", () => {
  it.each([
    ["high", "high"],
    ["removed", ""],
    [undefined, ""],
  ])("只展示有效的Current档位 %s", (thought, expected) => {
    expect(resolveDraftThoughtCurrentValue({ thought, thoughtLevels: ["low", "high"] })).toBe(
      expected,
    );
  });
});

describe("buildDraftCreateConfigPayload", () => {
  it("Draft跨Model Selection会清除源Model thought", () => {
    expect(
      applyDraftModelSelection(
        {
          provider: "glm",
          model: "GLM-5-Turbo",
          thought: "enabled",
          mode: "build",
        },
        { providerId: "glm", modelId: "GLM-5.2" },
      ),
    ).toEqual({
      provider: "glm",
      model: "GLM-5.2",
      modelSelection: { providerId: "glm", modelId: "GLM-5.2" },
      mode: "build",
    });
  });

  it("有Draft选择 → 携带 config 键；无选择 → 空对e（createSession 不带 config）", () => {
    expect(buildDraftCreateConfigPayload({ provider: "glm", model: "glm-4.7" })).toEqual({
      config: { provider: "glm", model: "glm-4.7" },
    });
    expect(buildDraftCreateConfigPayload({})).toEqual({});
  });

  it("app Interaction Behavior偏OK → createSession.config.followupMode", () => {
    expect(buildDraftCreateConfigPayload({}, "guide")).toEqual({
      config: { followupMode: "guide" },
    });
    expect(buildDraftCreateConfigPayload({ provider: "glm", model: "glm-4.7" }, "queue")).toEqual({
      config: {
        provider: "glm",
        model: "glm-4.7",
        followupMode: "queue",
      },
    });
  });

  it("createSession 只使用Current Composer Status", () => {
    expect(
      buildDraftCreateConfigPayload({ model: "deepseek-v4-pro", thought: "low" }, "queue"),
    ).toEqual({
      config: {
        model: "deepseek-v4-pro",
        thought: "low",
        followupMode: "queue",
      },
    });
  });
});

describe("shouldHydrateWorkspaceCatalog", () => {
  const modePresentation = [
    {
      id: "mode",
      name: "Mode",
      category: "mode" as const,
      type: "select" as const,
      currentValue: "build",
      options: [{ value: "build", name: "build" }],
    },
  ];
  const slashCatalog = [{ name: "review", description: "Review changes" }];

  it("ModelTable of Contents已继承但 slash Table of Contents被 task → draft Clear时仍需水合", () => {
    expect(
      shouldHydrateWorkspaceCatalog({
        configOptions: modePresentation,
        sessionId: null,
        slashCommands: [],
      }),
    ).toBe(true);
  });

  it("任OneTable of Contents缺失时水合；两份Table of Contents均就绪时Skip", () => {
    expect(
      shouldHydrateWorkspaceCatalog({
        configOptions: [],
        sessionId: null,
        slashCommands: slashCatalog,
      }),
    ).toBe(true);
    expect(
      shouldHydrateWorkspaceCatalog({
        configOptions: modePresentation,
        sessionId: null,
        slashCommands: slashCatalog,
      }),
    ).toBe(false);
  });
});
