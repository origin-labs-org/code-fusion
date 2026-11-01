import { describe, expect, it, vi } from "vitest";
import type { ProviderSettingsView } from "@origin-ai/cf-services";
import { projectProviderSettingsViewToFormProviders } from "@/lib/providerSettingsFormProjection.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";
import { persistPersonalProvider } from "@/lib/providerPersonalSave.js";
import { resolvePendingProviderDraftSave } from "@/settings/model-provider-section/ProviderDraftSave.js";

describe("Todo104 Provider Rule outer metadata form", () => {
  const view: ProviderSettingsView = {
    revision: 1,
    providerOrder: ["demo"],
    providerTemplates: [],
    providers: [
      {
        providerId: "demo",
        providerName: "Demo",
        templateId: "example",
        executable: false,
        issues: [],
        models: [],
        personalConfig: { api: { headers: { "x-route": "keep" } } },
        effectiveConfig: {
          api: {
            type: "anthropic-messages",
            baseUrl: "https://example.test",
            headers: { "x-route": "keep" },
          },
        },
      },
    ],
  };
  const draft = {
    nameValue: "Demo",
    apiFormat: "anthropic-messages" as const,
    baseUrlValue: "https://example.test",
    apiKeyValue: "",
  };

  it("读取外层名称/模板；未编辑不保存", () => {
    const provider = projectProviderSettingsViewToFormProviders(view)[0]!;
    expect(getProviderFormLabel(provider)).toBe("Demo");
    expect(provider.templateId).toBe("example");
    expect(provider.config).not.toHaveProperty("label");
    expect(resolvePendingProviderDraftSave({ provider, draft, now: () => 0 })).toBeNull();
  });

  it.each(["Renamed", ""])(
    'Renaming \"%s\" only submits outer name patch without materializing template/connection inherited values',
    async (nameValue) => {
      const provider = projectProviderSettingsViewToFormProviders(view)[0]!;
      const edited = resolvePendingProviderDraftSave({
        provider,
        draft: { ...draft, nameValue },
        nameConfirmed: true,
        now: () => 0,
      });
      expect(edited).not.toBeNull();
      expect(getProviderFormLabel(edited!)).toBe(nameValue || "demo");
      const savePersonalProviderOverlay = vi.fn(async () => view);
      await persistPersonalProvider({
        provider: edited!,
        providerSettingsService: { savePersonalProviderOverlay },
      });
      expect(savePersonalProviderOverlay).toHaveBeenCalledWith(
        "demo",
        view.providers[0]!.personalConfig,
        { providerName: nameValue || null },
      );
      expect(edited!.config).toEqual(provider.config);
    },
  );

  it("Only change address without writing inherited name as personal name; static headers are preserved", async () => {
    const provider = projectProviderSettingsViewToFormProviders(view)[0]!;
    const edited = resolvePendingProviderDraftSave({
      provider,
      draft: { ...draft, baseUrlValue: "https://next.test" },
      now: () => 0,
    })!;
    const savePersonalProviderOverlay = vi.fn(async () => view);
    await persistPersonalProvider({
      provider: edited,
      providerSettingsService: { savePersonalProviderOverlay },
    });
    expect(savePersonalProviderOverlay).toHaveBeenCalledWith(
      "demo",
      { api: { baseUrl: "https://next.test", headers: { "x-route": "keep" } } },
      undefined,
    );
  });
});
