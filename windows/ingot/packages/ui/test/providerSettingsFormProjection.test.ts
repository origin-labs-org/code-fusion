import { describe, expect, it } from "vitest";
import type { ProviderSettingsView } from "@origin-ai/cf-services";
import {
  projectProviderSettingsViewToFormProviders,
  resolveProviderSettingsFormProviders,
  resolveProviderOrdering,
  resolvePersonalProviderIds,
} from "@/lib/providerSettingsFormProjection.js";

describe("providerSettingsFormProjection", () => {
  it("API and Account projections only use Settings View, carrying no legacy Account runtime credentials", () => {
    const settings: ProviderSettingsView = {
      revision: 7,
      addableProviders: [],
      providerOrder: ["api-provider"],
      providers: [
        {
          providerId: "api-provider",
          enabled: true,
          executable: true,
          personalConfig: {
            access: { type: "api-key", apiKey: "new-key" },
            personalModelIds: ["model-a"],
          },
          effectiveConfig: {
            label: "API Provider",
            group: "standard-personal",
            access: { type: "api-key", apiKey: "new-key" },
            api: {
              type: "openai-chat-completions",
              baseUrl: "https://new.example.com/v1",
            },
            personalModelIds: ["model-a"],
          },
          issues: [],
          models: [
            {
              kind: "candidate",
              modelId: "model-a",
              builtin: false,
              personalConfig: { properties: { contextWindow: 128_000 } },
              effectiveConfig: {
                properties: {
                  requiresMfjsToolSchema: false,
                  contextWindow: 128_000,
                  inputFormat: {
                    supportsText: true,
                    supportsImage: true,
                    supportsVideo: true,
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
              enabled: true,
              executable: true,
              selectable: true,
              issues: [],
            },
          ],
        },
        {
          providerId: "account-plan",
          enabled: true,
          executable: true,
          effectiveConfig: {
            label: "Account Plan Config",
            group: "zai-family",
            access: {
              type: "zhipu-account",
            },
            api: {
              type: "anthropic-messages",
              baseUrl: "https://account.example.com",
            },
            builtinModelIds: ["account-model"],
          },
          issues: [],
          models: [
            {
              kind: "candidate",
              modelId: "account-model",
              builtin: true,
              effectiveConfig: {
                properties: {
                  requiresMfjsToolSchema: false,
                  contextWindow: 200_000,
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
                  maxOutputTokens: {
                    max: 64_000,
                  },
                },
              },
              enabled: true,
              executable: true,
              selectable: true,
              issues: [],
            },
          ],
        },
      ],
    };
    const result = projectProviderSettingsViewToFormProviders(settings);

    expect(result.map((provider) => provider.providerId)).toEqual(["api-provider", "account-plan"]);
    expect(result[0]).toMatchObject({
      providerId: "api-provider",
      executable: true,
      config: {
        label: "API Provider",
        access: { type: "api-key", apiKey: "new-key" },
        api: {
          type: "openai-chat-completions",
          baseUrl: "https://new.example.com/v1",
        },
      },
    });
    expect(result[0]?.models[0]).toMatchObject({
      modelId: "model-a",
      config: {
        properties: { contextWindow: 128_000 },
        optionSpecs: {
          maxOutputTokens: { max: 32_000 },
        },
      },
    });
    expect(result[1]).toMatchObject({
      providerId: "account-plan",
      executable: true,
      config: {
        label: "Account Plan Config",
        api: { baseUrl: "https://account.example.com" },
      },
      models: [
        expect.objectContaining({
          modelId: "account-model",
          config: expect.objectContaining({
            properties: expect.objectContaining({ contextWindow: 200_000 }),
            optionSpecs: expect.objectContaining({
              maxOutputTokens: expect.objectContaining({ max: 64_000 }),
            }),
          }),
        }),
      ],
    });
    expect(resolvePersonalProviderIds(settings)).toEqual(["api-provider"]);
    expect(
      resolveProviderOrdering({
        view: settings,
        providers: result,
      }),
    ).toEqual({
      displayOrder: {
        providerIds: ["api-provider", "account-plan"],
      },
      reorderableProviderIds: new Set(["api-provider"]),
    });
  });

  it("Still project Official Account Provider when legacy snapshot object does not exist", () => {
    const settings: ProviderSettingsView = {
      revision: 8,
      addableProviders: [],
      providerOrder: [],
      providers: [
        {
          providerId: "builtin:account-plan",
          enabled: true,
          executable: false,
          effectiveConfig: {
            label: "Account Plan",
            group: "zai-family",
            access: { type: "zhipu-account" },
            api: {
              type: "anthropic-messages",
              baseUrl: "https://account.example.com",
            },
            builtinModelIds: ["account-model"],
          },
          issues: [
            {
              code: "required",
              path: ["providers", "builtin:account-plan", "connection"],
              message: "Account connection is not ready yet",
            },
          ],
          models: [],
        },
      ],
    };

    expect(projectProviderSettingsViewToFormProviders(settings)).toEqual([
      expect.objectContaining({
        providerId: "builtin:account-plan",
        executable: false,
        config: expect.objectContaining({
          label: "Account Plan",
          access: { type: "zhipu-account" },
          api: {
            type: "anthropic-messages",
            baseUrl: "https://account.example.com",
          },
        }),
      }),
    ]);
  });

  it("Do not append Providers unique to legacy snapshot when Settings View is already published", () => {
    const settings: ProviderSettingsView = {
      revision: 9,
      providers: [],
    };

    expect(projectProviderSettingsViewToFormProviders(settings)).toEqual([]);
  });

  it("Keep empty list when Settings View is not yet published", () => {
    expect(
      resolveProviderSettingsFormProviders({
        view: null,
      }),
    ).toEqual([]);
  });
});
