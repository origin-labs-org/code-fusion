import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildPluginReferenceCatalog: vi.fn(),
  getCfPluginsOverview: vi.fn(),
  resolveCfPlugins: vi.fn(),
  updateCfPluginMarketplace: vi.fn(),
}));

vi.mock("@origin-ai/cf-core", () => ({
  buildPluginReferenceCatalog: mocks.buildPluginReferenceCatalog,
}));

vi.mock("../src/plugins.js", () => ({
  enrichCachedClaudeMarketplaceIconsForOverview: vi.fn(),
  getCfPluginsOverview: mocks.getCfPluginsOverview,
  resolveCfPlugins: mocks.resolveCfPlugins,
  updateCfPluginMarketplace: mocks.updateCfPluginMarketplace,
}));

import {
  cfPluginOperationStateSchema,
  cfPluginOperationProgressNotificationSchema,
  cfPluginsResolveSuggestedReferenceParamsSchema,
  cfPluginsResolveSuggestedReferenceResultSchema,
  cfProtocolNotifications,
} from "@origin-ai/cf-shared";
import type { PluginReferenceCatalogEntry } from "@origin-ai/cf-contracts";
import { resolveSuggestedPluginReference } from "../src/cf-protocol/plugin-reference-catalog.js";
import type { CfProtocolAgentServerContext } from "../src/cf-protocol/server-types.js";

const STABLE_ID = "document-skills@cf-plugins-official";
const WORKSPACE = { workspacePath: "/workspace", workspaceKey: "ssh://host/workspace" };
const DESKTOP_BOUNDARY = {
  operationId: "suggested-test",
  clientMode: "desktop-continuous" as const,
  deliveryKind: "desktop-continuous" as const,
};
const notify = vi.fn();

function protocolContext(): CfProtocolAgentServerContext {
  return { notify } as unknown as CfProtocolAgentServerContext;
}

function catalogEntry(
  overrides: Partial<PluginReferenceCatalogEntry> = {},
): PluginReferenceCatalogEntry {
  return {
    pluginId: STABLE_ID,
    name: "document-skills",
    marketplace: "cf-plugins-official",
    enabled: true,
    conflictingPluginIds: [],
    skillQualifiedNames: ["document-skills:pdf"],
    mcpServerNames: [],
    subagentNames: [],
    rootPath: "/plugins/document-skills",
    ...overrides,
  };
}

function overviewCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: STABLE_ID,
    name: "document-skills",
    marketplace: "cf-plugins-official",
    installed: false,
    listing: { displayName: "Document skills" },
    ...overrides,
  };
}

describe("plugins/resolveSuggestedReference protocol", () => {
  let entries: PluginReferenceCatalogEntry[];

  beforeEach(() => {
    entries = [];
    mocks.buildPluginReferenceCatalog.mockReset();
    mocks.buildPluginReferenceCatalog.mockImplementation(() => ({ plugins: entries }));
    mocks.resolveCfPlugins.mockReset();
    mocks.resolveCfPlugins.mockReturnValue({ diagnostics: [], plugins: [] });
    mocks.updateCfPluginMarketplace.mockReset();
    mocks.updateCfPluginMarketplace.mockResolvedValue({ diagnostics: [], marketplaces: [] });
    mocks.getCfPluginsOverview.mockReset();
    mocks.getCfPluginsOverview.mockReturnValue({
      availablePlugins: [],
      diagnostics: [],
      installedPlugins: [],
      marketplaces: [],
      restorableBuiltins: [],
    });
    notify.mockReset();
  });

  it("registers a strict request/result contract with operation and delivery boundaries", () => {
    expect(cfPluginOperationStateSchema.parse("cancelling")).toBe("cancelling");
    expect(cfPluginOperationStateSchema.parse("cancelled")).toBe("cancelled");
    expect(
      cfPluginOperationProgressNotificationSchema.parse({
        operationId: "suggested-1",
        state: "refreshing",
      }),
    ).toEqual({ operationId: "suggested-1", state: "refreshing" });
    expect(() =>
      cfPluginOperationProgressNotificationSchema.parse({
        operationId: "suggested-1",
        state: "refreshing",
        unexpected: true,
      }),
    ).toThrow();
    expect(
      cfPluginsResolveSuggestedReferenceParamsSchema.parse({
        workspace: WORKSPACE,
        stableId: STABLE_ID,
        operationId: "suggested-1",
        clientMode: "web-remote-replayable",
        deliveryKind: "web-remote-replayable",
      }),
    ).toEqual({
      workspace: WORKSPACE,
      stableId: STABLE_ID,
      operationId: "suggested-1",
      clientMode: "web-remote-replayable",
      deliveryKind: "web-remote-replayable",
    });
    expect(() =>
      cfPluginsResolveSuggestedReferenceParamsSchema.parse({
        workspace: WORKSPACE,
        stableId: STABLE_ID,
        operationId: "suggested-missing-client-mode",
        deliveryKind: "desktop-continuous",
      }),
    ).toThrow();
    expect(() =>
      cfPluginsResolveSuggestedReferenceParamsSchema.parse({
        workspace: WORKSPACE,
        stableId: STABLE_ID,
        clientMode: "desktop-continuous",
        deliveryKind: "desktop-continuous",
      }),
    ).toThrow();
    expect(() =>
      cfPluginsResolveSuggestedReferenceParamsSchema.parse({
        workspace: WORKSPACE,
        stableId: STABLE_ID,
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      cfPluginsResolveSuggestedReferenceResultSchema.parse({
        stableId: STABLE_ID,
        status: "missing",
        diagnostics: [],
      }),
    ).toThrow(/trusted install identity/);
    expect(
      cfPluginsResolveSuggestedReferenceResultSchema.parse({
        stableId: STABLE_ID,
        status: "ready",
        marketplace: "cf-plugins-official",
        pluginName: "document-skills",
        sourceTrust: "official",
        icon: "https://cdn.example/plugin.svg",
        diagnostics: [],
      }).icon,
    ).toBe("https://cdn.example/plugin.svg");
  });

  it("rejects non-official stable IDs without refreshing any marketplace", async () => {
    const result = await resolveSuggestedPluginReference(protocolContext(), {
      workspace: WORKSPACE,
      stableId: "document-skills@personal",
      ...DESKTOP_BOUNDARY,
    });

    expect(result.status).toBe("unavailable");
    expect(result.diagnostics[0]?.code).toBe("plugin_suggested_reference_untrusted_source");
    expect(mocks.updateCfPluginMarketplace).not.toHaveBeenCalled();
    expect(() => cfPluginsResolveSuggestedReferenceResultSchema.parse(result)).not.toThrow();
  });

  it.each([
    ["ready", true],
    ["disabled", false],
  ] as const)(
    "returns %s for an installed official plugin without refreshing",
    async (status, enabled) => {
      entries = [catalogEntry({ enabled })];
      mocks.getCfPluginsOverview.mockReturnValue({
        availablePlugins: [
          overviewCandidate({
            installed: true,
            listing: { icon: "https://cdn.example/document-skills.svg" },
          }),
        ],
        diagnostics: [],
        installedPlugins: [],
        marketplaces: [],
        restorableBuiltins: [],
      });

      const result = await resolveSuggestedPluginReference(protocolContext(), {
        workspace: WORKSPACE,
        stableId: STABLE_ID,
        ...DESKTOP_BOUNDARY,
      });

      expect(result).toMatchObject({
        stableId: STABLE_ID,
        status,
        marketplace: "cf-plugins-official",
        pluginName: "document-skills",
        sourceTrust: "official",
        icon: "https://cdn.example/document-skills.svg",
      });
      expect(mocks.updateCfPluginMarketplace).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    },
  );

  it("refreshes only cf-plugins-official before exposing a missing candidate", async () => {
    mocks.getCfPluginsOverview.mockReturnValue({
      availablePlugins: [
        overviewCandidate({ listing: { icon: "https://cdn.example/document-skills.svg" } }),
      ],
      diagnostics: [],
      installedPlugins: [],
      marketplaces: [],
      restorableBuiltins: [],
    });

    const result = await resolveSuggestedPluginReference(protocolContext(), {
      workspace: WORKSPACE,
      stableId: STABLE_ID,
      operationId: "suggested-2",
      clientMode: "desktop-continuous",
      deliveryKind: "desktop-continuous",
    });

    expect(mocks.updateCfPluginMarketplace).toHaveBeenCalledOnce();
    expect(mocks.updateCfPluginMarketplace).toHaveBeenCalledWith(
      expect.objectContaining({
        marketplace: "cf-plugins-official",
        workingDirectory: "/workspace",
      }),
    );
    expect(notify).toHaveBeenCalledWith({
      method: "plugins/operationProgress",
      params: { operationId: "suggested-2", state: "refreshing" },
    });
    expect(result).toMatchObject({
      stableId: STABLE_ID,
      status: "missing",
      marketplace: "cf-plugins-official",
      pluginName: "document-skills",
      sourceTrust: "official",
      icon: "https://cdn.example/document-skills.svg",
    });
  });

  it("emits refreshing after the first local miss and before marketplace refresh settles", async () => {
    let settleRefresh!: (value: { diagnostics: never[]; marketplaces: never[] }) => void;
    mocks.updateCfPluginMarketplace.mockReturnValue(
      new Promise((resolve) => {
        settleRefresh = resolve;
      }),
    );
    const pending = resolveSuggestedPluginReference(protocolContext(), {
      workspace: WORKSPACE,
      stableId: STABLE_ID,
      operationId: "suggested-progress",
      clientMode: "desktop-continuous",
      deliveryKind: "desktop-continuous",
    });

    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith({
        method: cfProtocolNotifications.pluginOperationProgress,
        params: { operationId: "suggested-progress", state: "refreshing" },
      });
    });
    expect(mocks.updateCfPluginMarketplace).toHaveBeenCalledOnce();

    settleRefresh({ diagnostics: [], marketplaces: [] });
    await expect(pending).resolves.toMatchObject({ status: "unavailable" });
  });

  it("fails closed after a refresh failure even when an old snapshot still has a candidate", async () => {
    mocks.updateCfPluginMarketplace.mockResolvedValue({
      diagnostics: [
        {
          code: "plugin_archive_fetch_failed",
          message: "offline",
          pluginId: "cf-plugins-official",
          severity: "error",
        },
      ],
      marketplaces: [],
    });
    mocks.getCfPluginsOverview.mockReturnValue({
      availablePlugins: [overviewCandidate()],
      diagnostics: [],
      installedPlugins: [],
      marketplaces: [],
      restorableBuiltins: [],
    });

    const result = await resolveSuggestedPluginReference(protocolContext(), {
      workspace: WORKSPACE,
      stableId: STABLE_ID,
      ...DESKTOP_BOUNDARY,
    });

    expect(result.status).toBe("unavailable");
    expect(result.diagnostics[0]?.code).toBe("marketplace_refresh_failed");
    expect(mocks.getCfPluginsOverview).not.toHaveBeenCalled();
  });

  it("fails closed and aborts the official marketplace refresh at ten seconds", async () => {
    let refreshSignal: AbortSignal | undefined;
    mocks.updateCfPluginMarketplace.mockImplementation(
      (options: { abortSignal?: AbortSignal }) => {
        refreshSignal = options.abortSignal;
        return new Promise(() => {});
      },
    );

    vi.useFakeTimers();
    try {
      const pending = resolveSuggestedPluginReference(protocolContext(), {
        workspace: WORKSPACE,
        stableId: STABLE_ID,
        ...DESKTOP_BOUNDARY,
      });
      await Promise.resolve();
      expect(refreshSignal).toBeInstanceOf(AbortSignal);

      vi.advanceTimersByTime(9_999);
      await Promise.resolve();
      expect(refreshSignal?.aborted).toBe(false);

      vi.advanceTimersByTime(1);
      const result = await pending;

      expect(refreshSignal?.aborted).toBe(true);
      expect(result.status).toBe("unavailable");
      expect(result.diagnostics[0]?.code).toBe("marketplace_refresh_failed");
      expect(mocks.getCfPluginsOverview).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports cancellation separately from marketplace refresh failure", async () => {
    const controller = new AbortController();
    mocks.updateCfPluginMarketplace.mockImplementation(async () => {
      controller.abort();
      throw controller.signal.reason;
    });

    const result = await resolveSuggestedPluginReference(
      protocolContext(),
      { workspace: WORKSPACE, stableId: STABLE_ID, ...DESKTOP_BOUNDARY },
      controller.signal,
    );

    expect(result.status).toBe("unavailable");
    expect(result.diagnostics[0]?.code).toBe("plugin_operation_cancelled");
  });

  it("re-resolves installed state from the refreshed catalog", async () => {
    mocks.updateCfPluginMarketplace.mockImplementation(async () => {
      entries = [catalogEntry()];
      return { diagnostics: [], marketplaces: [] };
    });

    const result = await resolveSuggestedPluginReference(protocolContext(), {
      workspace: WORKSPACE,
      stableId: STABLE_ID,
      ...DESKTOP_BOUNDARY,
    });

    expect(mocks.resolveCfPlugins).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("ready");
  });

  it("rejects a disappeared or identity-mismatched candidate after refresh", async () => {
    mocks.getCfPluginsOverview.mockReturnValue({
      availablePlugins: [overviewCandidate({ marketplace: "personal" })],
      diagnostics: [],
      installedPlugins: [],
      marketplaces: [],
      restorableBuiltins: [],
    });

    const result = await resolveSuggestedPluginReference(protocolContext(), {
      workspace: WORKSPACE,
      stableId: STABLE_ID,
      ...DESKTOP_BOUNDARY,
    });

    expect(result.status).toBe("unavailable");
    expect(result.diagnostics[0]?.code).toBe("plugin_suggested_reference_not_listed");
  });
});
