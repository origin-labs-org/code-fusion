import { describe, expect, it } from "vitest";
import type { ModelSelectionView } from "@origin-ai/cf-services";
import { resolveProviderBaseURL, resolveProviderLabel } from "@/lib/registryProviderView.js";

const registryView: ModelSelectionView = {
  revision: 2,
  providers: [
    {
      providerId: "api-provider",
      providerName: "Registry Label",
      config: {
        access: { type: "api-key", apiKey: "secret" },
        api: {
          type: "anthropic-messages",
          baseUrl: "https://registry.example.com",
        },
        models: ["model-a"],
      },
      models: [{ modelId: "model-a", config: {} }],
    },
  ],
};

describe("registryProviderView", () => {
  it("从 Registry View 读取 Provider 静态字段", () => {
    expect(resolveProviderLabel("api-provider", registryView)).toBe("Registry Label");
    expect(resolveProviderBaseURL("api-provider", registryView)).toBe(
      "https://registry.example.com",
    );
  });

  it("Returns stable fallback when Registry is not yet hydrated or does not contain Provider", () => {
    expect(resolveProviderLabel("account-provider", null)).toBe("account-provider");
    expect(resolveProviderBaseURL("account-provider", null)).toBeUndefined();
  });
});
