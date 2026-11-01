import { updateModelDraft } from "@/settings/model-provider-section/ProviderModelDraftState.js";
import { extractManualModelConfig } from "@origin-ai/cf-provider";
import { describe, expect, it } from "vitest";
import type {
  ProviderSettingsFormModel,
  ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import {
  resolvePendingProviderDraftSave,
  type ProviderDraftValues,
} from "@/settings/model-provider-section/ProviderDraftSave.js";
import {
  createProviderModelDraftValues,
  resolveProviderModelDraftCommit,
} from "@/settings/model-provider-section/ProviderModelMetadata.js";

function createProvider(
  overrides: Partial<ProviderSettingsFormProvider> = {},
): ProviderSettingsFormProvider {
  return {
    providerId: "provider-demo",
    providerName: "Demo Provider",
    executable: true,
    enabled: true,
    hasPersonalConfig: true,
    personalConfig: {
      group: "standard-personal",
      access: { type: "api-key", apiKey: "sk-old" },
      api: { type: "anthropic-messages", baseUrl: "https://old.example.com/v1" },
      personalModelIds: ["demo-model"],
      enabled: true,
    },
    config: {
      group: "standard-personal",
      access: { type: "api-key", apiKey: "sk-old" },
      api: {
        type: "anthropic-messages",
        baseUrl: "https://old.example.com/v1",
        headers: { "x-old": "remove-on-edit" },
      },
      personalModelIds: ["demo-model"],
      enabled: true,
    },
    models: [
      {
        kind: "candidate",
        modelId: "demo-model",
        builtin: false,
        personalConfig: {},
        config: {},
        hasPersonalConfig: true,
        executable: true,
        selectable: true,
      },
    ],
    ...overrides,
  };
}

function createDraft(overrides: Partial<ProviderDraftValues> = {}): ProviderDraftValues {
  return {
    nameValue: "Demo Provider",
    apiFormat: "openai-chat-completions",
    baseUrlValue: "https://new.example.com/v1/chat/completions",
    apiKeyValue: "sk-new",
    ...overrides,
  };
}

describe("Provider draft uses formal Provider Config", () => {
  it("Plan Key editing preserves Access type without materializing template management entry", () => {
    const provider = createProvider({
      personalConfig: {},
      config: {
        group: "standard-personal",
        access: {
          type: "zhipu-coding-plan-api-key",
          apiKey: "old",
          apiKeyManagementUrl: "https://z.ai/manage-apikey/apikey-list",
        },
        api: { type: "anthropic-messages", baseUrl: "https://api.z.ai/api/anthropic" },
      },
    });
    const result = resolvePendingProviderDraftSave({
      provider,
      draft: createDraft({
        apiFormat: "anthropic-messages",
        baseUrlValue: "https://api.z.ai/api/anthropic",
        apiKeyValue: "new",
      }),
      now: () => 0,
    });
    expect(result?.personalConfig).toEqual({
      access: { type: "zhipu-coding-plan-api-key", apiKey: "new" },
    });
    expect(result?.config.access).toEqual({ ...provider.config.access, apiKey: "new" });
  });
  it("Todo89：显示用 ID 和默认 API 类型不构成用户编辑", () => {
    const provider = createProvider({
      providerName: undefined,
      config: { group: "standard-personal" },
      personalConfig: { group: "standard-personal" },
    });
    expect(
      resolvePendingProviderDraftSave({
        provider,
        draft: {
          nameValue: provider.providerId,
          apiFormat: "anthropic-messages",
          baseUrlValue: "",
          apiKeyValue: "",
        },
        now: () => 0,
      }),
    ).toBeNull();
  });
  it("Todo89: Do not save without edits; editing name alone must not materialize connection or drop headers", () => {
    const provider = createProvider({ personalConfig: {} });
    const draft = createDraft({
      apiFormat: "anthropic-messages",
      baseUrlValue: "https://old.example.com/v1",
      apiKeyValue: "sk-old",
    });
    expect(resolvePendingProviderDraftSave({ provider, draft, now: () => 0 })).toBeNull();
    const renamed = resolvePendingProviderDraftSave({
      provider,
      draft: { ...draft, nameValue: "Renamed" },
      nameConfirmed: true,
      now: () => 0,
    });
    expect(renamed?.personalConfig).toEqual({});
    expect(renamed?.providerNameUpdate).toBe("Renamed");
    expect(renamed?.config.api?.headers).toEqual(provider.config.api?.headers);
  });

  it("Todo89: Modifying API address retains personal headers and does not copy inherited headers", () => {
    const provider = createProvider();
    provider.personalConfig.api = {
      ...provider.personalConfig.api,
      headers: { "x-personal": "kept" },
    };
    const saved = resolvePendingProviderDraftSave({ provider, draft: createDraft(), now: () => 0 });
    expect(saved?.personalConfig.api?.headers).toEqual({ "x-personal": "kept" });
  });
  it("Personal-only Provider 编辑连接信息时保存可编辑名称", () => {
    const result = resolvePendingProviderDraftSave({
      provider: createProvider(),
      draft: createDraft({ nameValue: "Renamed" }),
      nameConfirmed: true,
      now: () => 2,
    });

    expect(result?.providerNameUpdate).toBe("Renamed");
    expect(result?.config).toEqual({
      group: "standard-personal",
      access: { type: "api-key", apiKey: "sk-new" },
      api: {
        type: "openai-chat-completions",
        baseUrl: "https://new.example.com/v1/chat/completions",
        headers: { "x-old": "remove-on-edit" },
      },
      personalModelIds: ["demo-model"],
      enabled: true,
    });
  });

  it("只读连接只更新名称与 API Key", () => {
    const provider = createProvider();
    const result = resolvePendingProviderDraftSave({
      provider,
      draft: createDraft({ nameValue: "", baseUrlValue: "https://ignored.example" }),
      readOnlyEndpoints: true,
      nameConfirmed: true,
      now: () => 2,
    });

    expect(result?.config).not.toHaveProperty("label");
    expect(result?.providerNameUpdate).toBeNull();
    expect(result?.config.api).toEqual(provider.config.api);
    expect(result?.config.access).toEqual({ type: "api-key", apiKey: "sk-new" });
  });

  it("Unconfirmed names will not be included when saving connection drafts", () => {
    const provider = createProvider();
    const saved = resolvePendingProviderDraftSave({
      provider,
      draft: createDraft({ nameValue: "Unconfirmed" }),
      now: () => 0,
    });
    expect(saved?.providerName).toBe(provider.providerName);
    expect(saved).not.toHaveProperty("providerNameUpdate");
    expect(saved?.config.access).toMatchObject({ apiKey: "sk-new" });
  });

  it("Do not produce save object when there are no changes", () => {
    const provider = createProvider({
      config: {
        group: "standard-personal",
        access: { type: "api-key", apiKey: "sk-old" },
        api: { type: "anthropic-messages", baseUrl: "https://old.example.com/v1" },
        personalModelIds: ["demo-model"],
        enabled: true,
      },
    });
    expect(
      resolvePendingProviderDraftSave({
        provider,
        draft: createDraft({
          apiFormat: "anthropic-messages",
          baseUrlValue: "https://old.example.com/v1",
          apiKeyValue: "sk-old",
        }),
        now: () => 2,
      }),
    ).toBeNull();
  });

  it("Save empty Base URL as omitted field rather than invalid URL", () => {
    const result = resolvePendingProviderDraftSave({
      provider: createProvider(),
      draft: createDraft({ baseUrlValue: "" }),
      now: () => 2,
    });

    expect(result?.config.api).toEqual({
      type: "openai-chat-completions",
      headers: { "x-old": "remove-on-edit" },
    });
    expect(result?.personalConfig.api).toEqual({ type: "openai-chat-completions" });
  });
});

describe("Model metadata uses formal Model Config", () => {
  function createModel(): ProviderSettingsFormModel {
    return {
      kind: "candidate",
      modelId: "demo-model",
      builtin: true,
      inheritedConfig: {
        enabled: true,

        properties: {
          requiresMfjsToolSchema: false,
          contextWindow: 128_000,
          inputFormat: {
            supportsText: true,
            supportsImage: false,
            supportsVideo: false,
            supportsAudio: false,
            supportsPdf: false,
          },
          outputFormat: { supportsText: true },
          supportsToolCall: true,
          supportsJsonSchemaOutput: true,
          supportsNativeWebSearch: false,
          supportsMidConversationSystem: false,
        },
        optionSpecs: {
          reasoningLevel: {
            values: ["low", "high"],
            map: "{'reasoning_effort': reasoningLevel}",
          },
          maxOutputTokens: {
            max: 32_000,
            map: "{'max_completion_tokens': maxOutputTokens}",
          },
        },
      },
      personalConfig: {},
      hasPersonalConfig: false,
      executable: true,
      selectable: true,
      config: {
        properties: {
          requiresMfjsToolSchema: false,
          contextWindow: 128_000,
          inputFormat: {
            supportsText: true,
            supportsImage: false,
            supportsVideo: false,
            supportsAudio: false,
            supportsPdf: false,
          },
          outputFormat: { supportsText: true },
          supportsToolCall: true,
          supportsJsonSchemaOutput: true,
          supportsNativeWebSearch: false,
          supportsMidConversationSystem: false,
        },
        optionSpecs: {
          reasoningLevel: {
            values: ["low", "high"],
            map: "{'reasoning_effort': reasoningLevel}",
          },
          maxOutputTokens: {
            max: 32_000,
            map: "{'max_completion_tokens': maxOutputTokens}",
          },
        },
      },
    };
  }

  it("Edit draft only prepopulates Personal overrides, without disguising inherited capacity as user input", () => {
    expect(createProviderModelDraftValues(createModel())).toMatchObject({
      idValue: "demo-model",
      contextWindowValue: "",
      maxOutputTokensValue: "",
      enabledValue: true,
      supportsJsonSchemaOutputValue: true,
      supportsNativeWebSearchValue: false,
      supportsMidConversationSystemValue: false,

      inputFormatValue: {
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      },

      reasoningLevelValuesValue: ["low", "high"],
      reasoningLevelMapValue: "",
    });
  });

  it("Todo130：手动保存只冻结可编辑字段，不要求/保存隐藏映射或工具能力", () => {
    const model = createModel();
    model.config = {
      ...model.config,
      optionSpecs: { ...model.config.optionSpecs, maxOutputTokens: { max: 32000 } },
    };
    const draft = updateModelDraft(
      createProviderModelDraftValues(model),
      { useRecommendedConfigValue: false },
      model,
    );
    const result = resolveProviderModelDraftCommit({ currentModel: model, draft });
    expect(result.status).toBe("commit");
    if (result.status !== "commit") return;
    expect(result.model.personalConfig.properties).not.toHaveProperty("supportsToolCall");
    expect(result.model.personalConfig.properties).not.toHaveProperty("outputFormat");
    expect(result.model.personalConfig.properties?.inputFormat).toEqual({
      supportsImage: false,
      supportsVideo: false,
      supportsPdf: false,
    });
    expect(result.model.personalConfig.optionSpecs?.maxOutputTokens).toEqual({ max: 32000 });
    expect(result.model.personalConfig).not.toHaveProperty("enabled");
  });

  it("Existing Personal capacity overrides continue to serve as actual input values", () => {
    const model = createModel();
    model.personalConfig = {
      properties: { contextWindow: 64_000 },
      optionSpecs: { maxOutputTokens: { max: 8_000 } },
    };

    expect(createProviderModelDraftValues(model)).toMatchObject({
      contextWindowValue: "64000",
      maxOutputTokensValue: "8000",
    });
  });

  it("Explicitly removed values are treated as empty inputs to be fixed, not displaying null string", () => {
    const model = createModel();
    model.personalConfig = {
      properties: { contextWindow: null },
      optionSpecs: { maxOutputTokens: { max: null } },
    };
    expect(createProviderModelDraftValues(model)).toMatchObject({
      contextWindowValue: "",
      maxOutputTokensValue: "",
    });
  });

  it("Materialize currently effective editor fields when disabling following recommended configuration", () => {
    const result = resolveProviderModelDraftCommit({
      currentModel: createModel(),
      draft: updateModelDraft(
        createProviderModelDraftValues(createModel()),
        { useRecommendedConfigValue: false },
        createModel(),
      ),
    });

    expect(result.status).toBe("commit");
    if (result.status !== "commit") return;
    expect(result.model.useRecommendedConfig).toBe(false);
    const { enabled: _enabled, ...manual } = extractManualModelConfig(result.model.config);
    expect(result.model.personalConfig).toEqual(manual);
    expect(result.model.personalConfig).not.toHaveProperty("enabled");
  });

  it("缺少模式字段时默认跟随推荐配置", () => {
    expect(createProviderModelDraftValues(createModel()).useRecommendedConfigValue).toBe(true);
  });

  it("固定配置不能删除已有的禁用覆盖", () => {
    const model = createModel();
    model.personalConfig = { enabled: false };
    model.config = { ...model.config, enabled: false };
    const result = resolveProviderModelDraftCommit({
      currentModel: model,
      draft: updateModelDraft(
        createProviderModelDraftValues(model),
        { useRecommendedConfigValue: false },
        model,
      ),
    });
    expect(result.status).toBe("commit");
    if (result.status === "commit") expect(result.model.personalConfig.enabled).toBe(false);
  });

  it("切回跟随之后新输入的值仍能保存", () => {
    const model = createModel();
    model.personalConfig = { enabled: false, properties: { contextWindow: 64_000 } };
    const reset = createProviderModelDraftValues({
      ...model,
      personalConfig: {},
      config: model.inheritedConfig!,
    });
    const result = resolveProviderModelDraftCommit({
      currentModel: model,
      draft: {
        ...reset,
        contextWindowValue: "96000",
        useRecommendedConfigValue: true,
        clearPersonalConfigValue: true,
      },
    });
    expect(result.status).toBe("commit");
    if (result.status === "commit")
      expect(result.model.personalConfig).toMatchObject({
        enabled: false,
        properties: { contextWindow: 96_000 },
      });
  });

  it("Submission prohibited in fixed mode when complete max output configuration is missing", () => {
    const model = createModel();
    model.config.optionSpecs = { reasoningLevel: model.config.optionSpecs!.reasoningLevel };
    model.inheritedConfig!.optionSpecs = {
      reasoningLevel: model.inheritedConfig!.optionSpecs!.reasoningLevel,
    };
    expect(
      resolveProviderModelDraftCommit({
        currentModel: model,
        draft: updateModelDraft(
          createProviderModelDraftValues(model),
          { useRecommendedConfigValue: false },
          model,
        ),
      }),
    ).toEqual({ status: "invalid", field: "maxOutputTokens" });
  });

  it("Clear old Overlay when switching from fixed mode to follow, but retain model enabled state", () => {
    const model = createModel();
    model.personalConfig = {
      enabled: false,
      properties: { contextWindow: 64_000 },
    };
    const result = resolveProviderModelDraftCommit({
      currentModel: model,
      draft: {
        ...createProviderModelDraftValues({
          ...model,
          personalConfig: {},
          config: model.inheritedConfig!,
        }),
        useRecommendedConfigValue: true,
        clearPersonalConfigValue: true,
      },
    });

    expect(result.status).toBe("commit");
    if (result.status !== "commit") return;
    expect(result.model.personalConfig).toEqual({ enabled: false });
    expect(result.model.useRecommendedConfig).toBe(true);
  });

  it("Advanced fields are written to sparse Personal Rule; max output is determined by unique numeric input", () => {
    const result = resolveProviderModelDraftCommit({
      currentModel: createModel(),
      draft: {
        ...createProviderModelDraftValues(createModel()),
        enabledValue: false,
        supportsNativeWebSearchValue: true,

        maxOutputTokensValue: "12000",
        reasoningLevelValuesValue: ["none", "high"],
        reasoningLevelMapValue: "{'reasoning_effort': reasoningLevel}",
      },
    });

    expect(result.status).toBe("commit");
    if (result.status !== "commit") return;
    expect(result.model.personalConfig).toMatchObject({
      enabled: false,

      properties: {
        supportsNativeWebSearch: true,
      },
      optionSpecs: {
        reasoningLevel: { values: ["none", "high"] },
        maxOutputTokens: { max: 12_000 },
      },
    });
  });

  it("Retain draft and reject submission when reasoning tiers are empty or duplicated", () => {
    expect(
      resolveProviderModelDraftCommit({
        currentModel: createModel(),
        draft: {
          ...createProviderModelDraftValues(createModel()),
          reasoningLevelValuesValue: ["low", "low"],
        },
      }),
    ).toEqual({ status: "invalid", field: "reasoningLevelValues" });
  });

  it("Reasoning Mapping uses Personal value and restores inheritance when cleared", () => {
    const currentModel = createModel();
    currentModel.personalConfig = {
      optionSpecs: { reasoningLevel: { map: "{'thinking': {'type': 'enabled'}}" } },
    };
    currentModel.config = {
      ...currentModel.config,
      optionSpecs: {
        ...currentModel.config.optionSpecs,
        reasoningLevel: {
          ...currentModel.config.optionSpecs!.reasoningLevel!,
          map: "{'thinking': {'type': 'enabled'}}",
        },
      },
    };

    expect(createProviderModelDraftValues(currentModel).reasoningLevelMapValue).toBe(
      "{'thinking': {'type': 'enabled'}}",
    );
    const result = resolveProviderModelDraftCommit({
      currentModel,
      draft: { ...createProviderModelDraftValues(currentModel), reasoningLevelMapValue: "" },
    });

    expect(result.status).toBe("commit");
    if (result.status !== "commit") return;
    expect(result.model.personalConfig.optionSpecs?.reasoningLevel?.map).toBeUndefined();
    expect(result.model.config.optionSpecs?.reasoningLevel?.map).toBe(
      "{'reasoning_effort': reasoningLevel}",
    );
  });

  it("Reject non-compilable Reasoning Mapping", () => {
    expect(
      resolveProviderModelDraftCommit({
        currentModel: createModel(),
        draft: {
          ...createProviderModelDraftValues(createModel()),
          reasoningLevelMapValue: "reasoningLevel ??? {}",
        },
      }),
    ).toEqual({ status: "invalid", field: "reasoningLevelMap" });
  });

  it("Restore inherited value and delete Personal leaf when clearing context window", () => {
    const currentModel = createModel();
    currentModel.personalConfig = { properties: { contextWindow: 64_000 } };
    currentModel.config = {
      ...currentModel.config,
      properties: { ...currentModel.config.properties, contextWindow: 64_000 },
    };

    const result = resolveProviderModelDraftCommit({
      currentModel,
      draft: {
        ...createProviderModelDraftValues(currentModel),
        contextWindowValue: "",
      },
    });

    expect(result.status).toBe("commit");
    if (result.status !== "commit") return;
    expect(result.model.config.properties?.contextWindow).toBe(128_000);
    expect(result.model.personalConfig.properties?.contextWindow).toBeUndefined();
  });

  it("Update visible fields and retain reasoning configuration upon submission", () => {
    const result = resolveProviderModelDraftCommit({
      currentModel: createModel(),
      draft: {
        ...createProviderModelDraftValues(createModel()),
        idValue: "renamed-model",
        contextWindowValue: "200000",
        maxOutputTokensValue: "8000",
        inputFormatValue: {
          supportsText: true,
          supportsImage: true,
          supportsVideo: false,
          supportsAudio: false,
          supportsPdf: false,
        },
      },
    });
    expect(result.status).toBe("commit");
    if (result.status !== "commit") return;
    expect(result.model.modelId).toBe("renamed-model");
    expect(result.model.hasPersonalConfig).toBe(true);
    expect(result.model.config.properties?.contextWindow).toBe(200_000);
    expect(result.model.config.optionSpecs?.maxOutputTokens).toEqual({
      max: 8_000,
      map: "{'max_completion_tokens': maxOutputTokens}",
    });
    expect(result.model.config.optionSpecs?.reasoningLevel?.map).toBe(
      "{'reasoning_effort': reasoningLevel}",
    );
  });

  it("Max output directly edits max; both scaling up and down form an exact Personal max", () => {
    const currentModel = createModel();
    currentModel.personalConfig = {
      optionSpecs: { maxOutputTokens: { max: 8_000 } },
    };
    currentModel.config = {
      ...currentModel.config,
      optionSpecs: {
        ...currentModel.config.optionSpecs,
        maxOutputTokens: { max: 8_000 },
      },
    };

    const unchanged = resolveProviderModelDraftCommit({
      currentModel,
      draft: createProviderModelDraftValues(currentModel),
    });
    expect(unchanged.status).toBe("commit");
    if (unchanged.status !== "commit") return;
    expect(unchanged.model.personalConfig.optionSpecs?.maxOutputTokens).toEqual({
      max: 8_000,
    });

    const expanded = resolveProviderModelDraftCommit({
      currentModel,
      draft: { ...createProviderModelDraftValues(currentModel), maxOutputTokensValue: "64000" },
    });
    expect(expanded.status).toBe("commit");
    if (expanded.status !== "commit") return;
    expect(expanded.model.personalConfig.optionSpecs?.maxOutputTokens).toEqual({
      max: 64_000,
    });

    const shrunk = resolveProviderModelDraftCommit({
      currentModel,
      draft: { ...createProviderModelDraftValues(currentModel), maxOutputTokensValue: "2000" },
    });
    expect(shrunk.status).toBe("commit");
    if (shrunk.status !== "commit") return;
    expect(shrunk.model.personalConfig.optionSpecs?.maxOutputTokens).toEqual({
      max: 2_000,
    });
  });

  it("显式填写与推荐相等的最大输出仍保留个人意图", () => {
    const currentModel = createModel();
    const result = resolveProviderModelDraftCommit({
      currentModel,
      draft: {
        ...createProviderModelDraftValues(currentModel),
        maxOutputTokensValue: "32000",
      },
    });

    expect(result.status).toBe("commit");
    if (result.status !== "commit") return;
    expect(result.model.personalConfig.optionSpecs?.maxOutputTokens).toEqual({ max: 32000 });
  });

  it("清空最大输出时删除 Personal Option Spec 并恢复继承值", () => {
    const currentModel = createModel();
    currentModel.personalConfig = {
      optionSpecs: { maxOutputTokens: { max: 8_000 } },
    };
    currentModel.config = {
      ...currentModel.config,
      optionSpecs: {
        ...currentModel.config.optionSpecs,
        maxOutputTokens: { max: 8_000 },
      },
    };

    const result = resolveProviderModelDraftCommit({
      currentModel,
      draft: { ...createProviderModelDraftValues(currentModel), maxOutputTokensValue: "" },
    });

    expect(result.status).toBe("commit");
    if (result.status !== "commit") return;
    expect(result.model.personalConfig.optionSpecs?.maxOutputTokens).toBeUndefined();
    expect(result.model.config.optionSpecs?.maxOutputTokens).toEqual({
      max: 32_000,
      map: "{'max_completion_tokens': maxOutputTokens}",
    });
  });

  it("Retain hidden Audio facts as-is when editing visible Image/Video/PDF", () => {
    const currentModel = createModel();
    currentModel.config.properties = {
      ...currentModel.config.properties,
      inputFormat: {
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: true,
        supportsPdf: true,
      },
      outputFormat: { supportsText: true },
    };
    const draft = createProviderModelDraftValues(currentModel);
    const result = resolveProviderModelDraftCommit({
      currentModel,
      draft: {
        ...draft,
        inputFormatValue: {
          ...draft.inputFormatValue,
          supportsImage: true,
          supportsPdf: false,
        },
      },
    });

    expect(result.status).toBe("commit");
    if (result.status !== "commit") return;
    expect(result.model.config.properties?.inputFormat).toEqual({
      supportsText: true,
      supportsImage: true,
      supportsVideo: false,
      supportsAudio: true,
      supportsPdf: false,
    });
  });

  it("拒绝空模型 ID 和非正整数容量", () => {
    expect(
      resolveProviderModelDraftCommit({
        currentModel: createModel(),
        draft: {
          idValue: "",
          contextWindowValue: "128000",
          maxOutputTokensValue: "32000",
          inputFormatValue: {
            supportsText: true,
            supportsImage: false,
            supportsVideo: false,
            supportsAudio: false,
            supportsPdf: false,
          },
        },
      }),
    ).toEqual({ status: "invalid", field: "id" });
    expect(
      resolveProviderModelDraftCommit({
        currentModel: createModel(),
        draft: {
          idValue: "demo-model",
          contextWindowValue: "0",
          maxOutputTokensValue: "32000",
          inputFormatValue: {
            supportsText: true,
            supportsImage: false,
            supportsVideo: false,
            supportsAudio: false,
            supportsPdf: false,
          },
        },
      }),
    ).toEqual({ status: "invalid", field: "contextWindow" });
  });
});
