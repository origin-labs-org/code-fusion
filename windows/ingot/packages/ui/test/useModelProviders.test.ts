// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { IProviderSettingsService, ProviderSettingsView } from "@origin-ai/cf-services";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { persistPersonalProvider } from "@/lib/providerPersonalSave.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { useModelProviders } from "@/hooks/useModelProviders.js";

function createProviderSettingsView(
  providerIds: readonly string[],
  revision: number,
): ProviderSettingsView {
  return {
    revision,
    addableProviders: [],
    providerOrder: [...providerIds],
    providers: providerIds.map((providerId) => ({
      providerId,
      providerName: providerId,
      enabled: true,
      executable: true,
      effectiveConfig: {
        group: "standard-personal",
        api: { type: "anthropic-messages", baseUrl: "https://example.com" },
        access: { type: "api-key", apiKey: "test-key" },
      },
      personalConfig: {
        group: "standard-personal",
      },
      issues: [],
      models: [],
    })),
  };
}

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
      access: { type: "api-key", apiKey: "sk-demo" },
      api: { type: "openai-chat-completions", baseUrl: "https://api.example.com" },
      personalModelIds: ["demo-model"],
      enabled: true,
    },
    config: {
      group: "standard-personal",
      access: { type: "api-key", apiKey: "sk-demo" },
      api: {
        type: "openai-chat-completions",
        baseUrl: "https://api.example.com",
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

describe("Provider Personal Overlay persistence", () => {
  it("Save Provider 只写 Personal Config", async () => {
    const nextProvider = createProvider({
      config: {
        ...createProvider().config,
        access: { type: "api-key", apiKey: "sk-new" },
      },
    });
    const savePersonalProviderOverlay = vi.fn(async () => ({
      revision: 2,
      providers: [],
    }));

    const savedView = await persistPersonalProvider({
      provider: nextProvider,
      providerSettingsService: {
        savePersonalProviderOverlay,
      },
    });

    expect(savePersonalProviderOverlay).toHaveBeenCalledWith(
      nextProvider.providerId,
      expect.not.objectContaining({ personalModelIds: expect.anything() }),
      undefined,
    );
    expect(savedView).toEqual({ revision: 2, providers: [] });
    expect(savePersonalProviderOverlay).toHaveBeenCalledTimes(1);
  });

  it("New Provider Save不顺带遍历Model Configuration", async () => {
    const provider = createProvider({
      providerId: "new-provider",
      personalConfig: {
        access: { type: "api-key", apiKey: "sk-demo" },
        api: {
          type: "openai-chat-completions",
          baseUrl: "https://new.example.com/v1",
        },
        personalModelIds: ["new-model"],
        enabled: true,
      },
      config: {
        label: "New Provider",
        access: { type: "api-key", apiKey: "sk-demo" },
        api: {
          type: "openai-chat-completions",
          baseUrl: "https://new.example.com/v1",
        },
        personalModelIds: ["new-model"],
        enabled: true,
      },
      models: [
        {
          kind: "candidate",
          modelId: "new-model",
          builtin: false,
          personalConfig: {
            properties: {
              contextWindow: 128_000,
              supportsToolCall: true,
              supportsJsonSchemaOutput: true,
            },
            optionSpecs: {
              maxOutputTokens: { max: 16_000 },
            },
          },
          hasPersonalConfig: true,
          executable: false,
          selectable: false,
          config: {
            properties: {
              contextWindow: 128_000,
              supportsToolCall: true,
              supportsJsonSchemaOutput: true,
            },
            optionSpecs: {
              maxOutputTokens: {
                max: 16_000,
              },
            },
          },
        },
      ],
    });
    const savePersonalProviderOverlay = vi.fn(async () => ({
      revision: 2,
      providers: [],
    }));
    await persistPersonalProvider({
      provider,
      providerSettingsService: {
        savePersonalProviderOverlay,
      },
    });

    expect(savePersonalProviderOverlay).toHaveBeenCalledWith(
      "new-provider",
      expect.objectContaining({
        access: { type: "api-key", apiKey: "sk-demo" },
        api: {
          type: "openai-chat-completions",
          baseUrl: "https://new.example.com/v1",
        },
      }),
      undefined,
    );
  });
});

describe("useModelProviders", () => {
  it("Model连通性Tests使用显式的Local workspace，而不YesRemote激活路径", async () => {
    const service = {
      getView: vi.fn(async () => createProviderSettingsView(["provider-a"], 1)),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      testModelConnectivity: vi.fn(async () => ({ success: true as const })),
    } as unknown as IProviderSettingsService;
    const wrapper = ({ children }: { children: ReactNode }) =>
      ServiceProvider({
        services: { providerSettingsService: service } as never,
        children,
      });
    const hook = renderHook(
      () =>
        useModelProviders({
          workspacePath: "/remote/workspace",
          workspaceIdentity: "remote:test",
          connectivityWorkspaceRequired: true,
          connectivityWorkspacePath: "/local/workspace",
        }),
      { wrapper },
    );

    await waitFor(() => expect(hook.result.current.modelProviders).toHaveLength(1));
    await act(async () => {
      await hook.result.current.testModelConnectivity("provider-a", "model-a");
    });

    expect(service.testModelConnectivity).toHaveBeenCalledWith({
      workspacePath: "/local/workspace",
      providerId: "provider-a",
      modelId: "model-a",
    });
  });

  it("Remote激活且没有Local workspace 时不把Remote路径SendTo Local Service", async () => {
    const service = {
      getView: vi.fn(async () => createProviderSettingsView(["provider-a"], 1)),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      testModelConnectivity: vi.fn(async () => ({ success: true as const })),
    } as unknown as IProviderSettingsService;
    const wrapper = ({ children }: { children: ReactNode }) =>
      ServiceProvider({
        services: { providerSettingsService: service } as never,
        children,
      });
    const hook = renderHook(
      () =>
        useModelProviders({
          workspacePath: "/remote/workspace",
          workspaceIdentity: "remote:test",
          connectivityWorkspaceRequired: true,
          connectivityUnavailableMessage: "local workspace unavailable",
        }),
      { wrapper },
    );

    await waitFor(() => expect(hook.result.current.modelProviders).toHaveLength(1));
    await expect(
      hook.result.current.testModelConnectivity("provider-a", "model-a"),
    ).resolves.toEqual({
      success: false,
      error: { message: "local workspace unavailable" },
    });
    expect(service.testModelConnectivity).not.toHaveBeenCalled();
  });

  it("DeleteBack的最New View 时，即使 change event 丢失也立即移除 Provider", async () => {
    let currentView = createProviderSettingsView(["deleted"], 1);
    const service = {
      getView: vi.fn(async () => currentView),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      deletePersonalProvider: vi.fn(async () => {
        currentView = createProviderSettingsView([], 2);
        return currentView;
      }),
      refresh: vi.fn(async () => currentView),
    } as unknown as IProviderSettingsService;
    const wrapper = ({ children }: { children: ReactNode }) =>
      ServiceProvider({
        services: { providerSettingsService: service } as never,
        children,
      });
    const hook = renderHook(
      () =>
        useModelProviders({ workspacePath: "/remote/workspace", workspaceIdentity: "remote:test" }),
      { wrapper },
    );

    await waitFor(() => expect(hook.result.current.modelProviders).toHaveLength(1));
    await act(async () => {
      await hook.result.current.deleteProvider("deleted");
    });

    expect(hook.result.current.modelProviders).toHaveLength(0);
  });

  it("Manual RefreshSubmitBack的最New View，而不Yes仅Waiting远端Events", async () => {
    let currentView = createProviderSettingsView(["before-refresh"], 1);
    const service = {
      getView: vi.fn(async () => currentView),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      refresh: vi.fn(async () => {
        currentView = createProviderSettingsView(["after-refresh"], 2);
        return currentView;
      }),
    } as unknown as IProviderSettingsService;
    const wrapper = ({ children }: { children: ReactNode }) =>
      ServiceProvider({
        services: { providerSettingsService: service } as never,
        children,
      });
    const hook = renderHook(
      () =>
        useModelProviders({ workspacePath: "/remote/workspace", workspaceIdentity: "remote:test" }),
      { wrapper },
    );

    await waitFor(() =>
      expect(hook.result.current.modelProviders[0]?.providerId).toBe("before-refresh"),
    );
    await act(async () => {
      await hook.result.current.refresh();
    });

    expect(hook.result.current.modelProviders.map((provider) => provider.providerId)).toEqual([
      "after-refresh",
    ]);
  });
});
