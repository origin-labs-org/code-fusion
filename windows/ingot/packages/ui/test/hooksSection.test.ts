import type { IHooksService } from "@origin-ai/cf-services";
import type { Hook } from "@origin-ai/cf-shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { HooksList, groupHookSections } from "@/settings/HooksList.js";
import {
  buildPluginHookRows,
  filterPluginHooksByScope,
  isReadOnlyCfHook,
  resolveHookScopeTarget,
  resolveLatestReviewScopeTarget,
} from "@/settings/HooksSection.js";
import { useHooksStore } from "@/store/hooksStore.js";

afterEach(() => {
  useHooksStore.setState({
    workspacePath: null,
    workspaceIdentity: null,
    authorityKey: null,
    loadedWorkspaceKey: null,
    hooks: [],
    loading: false,
    error: null,
    operatingHookId: null,
  });
});

describe("Hooks settings page", () => {
  it("keeps same-name plugin hooks in separate marketplace groups", () => {
    const sections = groupHookSections(
      [],
      [],
      [
        {
          pluginId: "computer-use@cf-plugins-official",
          pluginName: "computer-use",
          detail: { event: "PreToolUse", type: "command", command: "official" },
          pluginEnabled: true,
        },
        {
          pluginId: "cf-cua@custom-marketplace",
          pluginName: "cf-cua",
          detail: { event: "PreToolUse", type: "command", command: "custom" },
          pluginEnabled: true,
        },
      ],
    );

    expect(sections.filter((section) => section.kind === "plugin")).toHaveLength(2);
    expect(
      sections
        .filter((section) => section.kind === "plugin")
        .flatMap((section) => section.hooks.map((hook) => hook.pluginId)),
    ).toEqual(["computer-use@cf-plugins-official", "cf-cua@custom-marketplace"]);
  });

  it("keeps a selected local workspace scope on the base host while a remote workspace is active", () => {
    const activePath = "/home/dev/project";
    const activeIdentity = "remote:server:source-1:/home/dev/project";

    expect(
      resolveHookScopeTarget(
        { workspacePath: "/Users/dev/local", workspaceIdentity: undefined },
        activePath,
        activeIdentity,
      ),
    ).toEqual({ workspacePath: "/Users/dev/local", workspaceIdentity: undefined });
    expect(
      resolveHookScopeTarget(
        { workspacePath: "/srv/other", workspaceIdentity: "remote:server:source-2:/srv/other" },
        activePath,
        activeIdentity,
      ),
    ).toEqual({
      workspacePath: "/srv/other",
      workspaceIdentity: "remote:server:source-2:/srv/other",
    });
    expect(resolveHookScopeTarget(undefined, activePath, activeIdentity)).toEqual({
      workspacePath: activePath,
      workspaceIdentity: activeIdentity,
    });
  });

  it("does not classify plugin hooks as user when overview scope is unavailable", () => {
    const pluginRows = buildPluginHookRows(
      [
        {
          id: "quality@official",
          name: "quality",
          enabled: true,
          hookDetails: [
            {
              event: "PreToolUse",
              type: "command",
              command: "./check.sh",
              sourcePath: "/plugins/quality/hooks/hooks.json",
              runnable: true,
            },
          ],
        },
      ],
      [],
      false,
    );

    expect(pluginRows).toHaveLength(1);
    expect(pluginRows[0]?.pluginScope).toBeUndefined();
    expect(filterPluginHooksByScope(pluginRows, "user")).toEqual(pluginRows);
    expect(filterPluginHooksByScope(pluginRows, "project")).toEqual(pluginRows);

    const workspaceRows = buildPluginHookRows(
      [
        {
          id: "quality@official",
          name: "quality",
          enabled: true,
          hookDetails: pluginRows.map((row) => row.detail),
        },
      ],
      [{ id: "quality@official", scope: "workspace" }],
      true,
    );
    expect(filterPluginHooksByScope(workspaceRows, "user")).toEqual([]);
    expect(filterPluginHooksByScope(workspaceRows, "project")).toEqual(workspaceRows);
  });

  it("persists per-hook enabled state through saveHooks with workspace identity", async () => {
    const saved: Array<Parameters<IHooksService["saveHooks"]>[0]> = [];
    let persistedHooks = [configuredHook()];
    const service: IHooksService = {
      async loadHooks() {
        return {
          hooks: persistedHooks,
          hooksEnabled: persistedHooks.some((hook) => hook.enabled),
        };
      },
      async saveHooks(params) {
        saved.push(params);
        persistedHooks = params.hooks;
      },
    };
    useHooksStore.setState({
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://dev/workspace",
      hooks: persistedHooks,
    });

    await useHooksStore.getState().toggleHook("configured", false, service);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://dev/workspace",
    });
    expect(saved[0]?.hooks[0]).toMatchObject({
      id: "configured",
      enabled: false,
    });
  });

  it("discards a stale hooks load after the workspace scope changed", async () => {
    const hookA: Hook = { ...configuredHook(), id: "hook-a", command: "echo a" };
    const hookB: Hook = { ...configuredHook(), id: "hook-b", command: "echo b" };
    let releaseSlowLoad: (() => void) | undefined;
    const slowLoad = new Promise<void>((resolve) => {
      releaseSlowLoad = resolve;
    });
    const saved: Array<Parameters<IHooksService["saveHooks"]>[0]> = [];
    const service: IHooksService = {
      async loadHooks(params) {
        if (params.workspacePath === "/workspace-a") {
          await slowLoad;
          return { hooks: [hookA], hooksEnabled: true };
        }
        return { hooks: [hookB], hooksEnabled: true };
      },
      async saveHooks(params) {
        saved.push(params);
      },
    };

    const slowInitialize = useHooksStore.getState().initialize("/workspace-a", undefined, service);
    await useHooksStore.getState().initialize("/workspace-b", undefined, service);
    releaseSlowLoad?.();
    await slowInitialize;

    expect(useHooksStore.getState().loadedWorkspaceKey).toBe("/workspace-b");
    expect(useHooksStore.getState().hooks.map((hook) => hook.id)).toEqual(["hook-b"]);

    await useHooksStore.getState().toggleHook("hook-b", false, service);

    expect(saved).toHaveLength(1);
    expect(saved[0]?.workspacePath).toBe("/workspace-b");
    expect(saved[0]?.hooks.map((hook) => hook.id)).toEqual(["hook-b"]);
  });

  it("imports a compatibility hook as an enabled CodeFusion hook", async () => {
    const legacy: Hook = {
      id: "legacy",
      event: "Stop",
      type: "command",
      command: "echo legacy",
      enabled: false,
      location: {
        source: "claude",
        scope: "project",
        directoryPath: "/workspace/.claude",
        projectPath: "/workspace",
      },
    };
    let persistedHooks = [legacy];
    const service: IHooksService = {
      async loadHooks() {
        return {
          hooks: persistedHooks,
          hooksEnabled: persistedHooks.some((hook) => hook.enabled),
        };
      },
      async saveHooks(params) {
        persistedHooks = params.hooks;
      },
    };
    useHooksStore.setState({
      workspacePath: "/workspace",
      hooks: persistedHooks,
    });

    await useHooksStore.getState().importHook("legacy", service);

    expect(persistedHooks).toContainEqual(
      expect.objectContaining({
        event: "Stop",
        command: "echo legacy",
        enabled: true,
        location: expect.objectContaining({
          source: "cf",
          scope: "project",
        }),
      }),
    );
  });

  it("groups direct, plugin, and compatibility hooks by source", () => {
    const legacy: Hook = {
      id: "legacy",
      event: "Stop",
      type: "command",
      command: "echo legacy",
      enabled: false,
      location: {
        source: "claude",
        scope: "project",
        directoryPath: "/workspace/.claude",
      },
    };

    const sections = groupHookSections(
      [configuredHook(), { ...configuredHook(), id: "configured-2", event: "Stop" }],
      [legacy],
      [
        {
          pluginId: "quality@official",
          pluginName: "quality",
          pluginEnabled: true,
          pluginScope: undefined,
          detail: {
            event: "PostToolUse",
            matcher: "Write",
            type: "command",
            command: "./check.sh",
            sourcePath: "/plugins/quality/hooks/hooks.json",
            runnable: true,
          },
        },
      ],
    );
    expect(sections.map((section) => section.kind)).toEqual(["installed", "plugin", "legacy"]);
    expect(sections[1]).toMatchObject({ title: "quality", count: 1 });

    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(
          TooltipProvider,
          null,
          createElement(HooksList, {
            compatibilityHooks: [legacy],
            editableHooks: [
              configuredHook(),
              { ...configuredHook(), id: "configured-2", event: "Stop" },
            ],
            operatingHookId: null,
            pluginHooks: [
              {
                pluginId: "quality@official",
                pluginName: "quality",
                pluginEnabled: true,
                pluginScope: undefined,
                pluginIconItem: { name: "quality", listing: undefined },
                detail: {
                  event: "PostToolUse",
                  matcher: "Write",
                  type: "command",
                  command: "./check.sh",
                  sourcePath: "/plugins/quality/hooks/hooks.json",
                  runnable: true,
                },
              },
            ],
            onDelete: async () => {},
            onEdit: () => {},
            onImport: async () => {},
            onToggle: async () => {},
            installedAction: createElement("button", null, "New"),
            showInstalledSection: true,
          }),
        ),
      ),
    );

    expect(html).toContain("PreToolUse");
    expect(html).toContain("Stop");
    expect(html).toContain("Installed");
    expect(html).toContain("New");
    expect(html).toContain("Legacy");
    expect(html).toContain("PostToolUse");
    expect(html).toContain("quality");
    expect(html).toContain("Scope unknown");
    expect(html).toContain("plugin-hook-row");
  });

  it("omits empty groups after filtering", () => {
    expect(groupHookSections([], [], [])).toEqual([]);
  });

  it("Show inline trust button for untrusted Workspace Hook without requiring active review", () => {
    const untrusted = {
      ...workspaceConfiguredHook("pending_trust"),
      id: "untrusted-disabled-row",
      enabled: false,
      workspaceHook: {
        ...workspaceConfiguredHook("pending_trust").workspaceHook!,
        configuredEnabled: false,
        reviewItemId: "untrusted-review-item",
      },
    };
    const trusted = {
      ...workspaceConfiguredHook("trusted_persistent"),
      id: "trusted-hook",
      workspaceHook: {
        ...workspaceConfiguredHook("trusted_persistent").workspaceHook!,
        reviewItemId: "trusted-hook",
      },
    };

    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(
          TooltipProvider,
          null,
          createElement(HooksList, {
            compatibilityHooks: [],
            editableHooks: [untrusted, trusted],
            operatingHookId: null,
            pluginHooks: [],
            trustActionAvailable: true,
            trustingHookId: null,
            onEdit: () => {},
            onImport: async () => {},
            onToggle: async () => {},
            onTrust: async () => {},
          }),
        ),
      ),
    );

    expect(html.match(/>Trust</gu)).toHaveLength(1);
  });

  it("Untrusted Hook\'s effective run toggle is fixed off and locked, without modifying incoming config state", () => {
    const untrustedConfiguredOn = workspaceConfiguredHook("pending_trust");
    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(
          TooltipProvider,
          null,
          createElement(HooksList, {
            compatibilityHooks: [],
            editableHooks: [untrustedConfiguredOn],
            operatingHookId: null,
            pluginHooks: [],
            trustActionAvailable: false,
            trustingHookId: null,
            onEdit: () => {},
            onImport: async () => {},
            onToggle: async () => {},
            onTrust: async () => {},
          }),
        ),
      ),
    );

    expect(untrustedConfiguredOn.enabled).toBe(true);
    expect(html).toContain(">Trust<");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<svg[^>]*lucide-shield-check/su);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"[^>]*disabled=""/u);
  });

  it("Hide Trust after persisting trust, restoring config toggle\'s actual value and operability", () => {
    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(
          TooltipProvider,
          null,
          createElement(HooksList, {
            compatibilityHooks: [],
            editableHooks: [workspaceConfiguredHook("trusted_persistent")],
            operatingHookId: null,
            pluginHooks: [],
            trustActionAvailable: true,
            trustingHookId: null,
            onEdit: () => {},
            onImport: async () => {},
            onToggle: async () => {},
            onTrust: async () => {},
          }),
        ),
      ),
    );

    expect(html).not.toContain(">Trust<");
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/u);
    expect(html).not.toMatch(/role="switch"[^>]*disabled=""/u);
  });

  it("readonly cf workspace hook stays in installed section with trust, not legacy import", () => {
    const readOnlyHook: Hook = {
      ...workspaceConfiguredHook("pending_trust"),
      editable: false,
      location: {
        source: "cf",
        scope: "project",
        directoryPath: "/ancestor/.cf",
        projectPath: "/workspace",
      },
    };
    expect(isReadOnlyCfHook(readOnlyHook)).toBe(true);
    expect(isReadOnlyCfHook(workspaceConfiguredHook("pending_trust"))).toBe(false);

    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(
          TooltipProvider,
          null,
          createElement(HooksList, {
            compatibilityHooks: [],
            editableHooks: [readOnlyHook],
            operatingHookId: null,
            pluginHooks: [],
            trustActionAvailable: true,
            trustingHookId: null,
            onEdit: () => {},
            onImport: async () => {},
            onToggle: async () => {},
            onTrust: async () => {},
          }),
        ),
      ),
    );

    expect(html).toContain("Installed");
    expect(html).not.toContain("Legacy");
    expect(html).toContain(">Trust<");
    expect(html).not.toContain(">Import<");
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"[^>]*disabled=""/u);
  });

  it("discards a stale refresh before it starts and never claims loading", async () => {
    let releaseLoad: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    let loadCalls = 0;
    const service: IHooksService = {
      async loadHooks() {
        loadCalls += 1;
        await gate;
        return { hooks: [], hooksEnabled: false };
      },
      async saveHooks() {},
    };
    useHooksStore.setState({ workspacePath: "/workspace-b", workspaceIdentity: null });
    const pending = useHooksStore.getState().refresh(service, { workspacePath: "/workspace-a" });
    expect(useHooksStore.getState().loading).toBe(false);
    releaseLoad?.();
    await pending;
    expect(loadCalls).toBe(0);
    expect(useHooksStore.getState().loading).toBe(false);
  });

  it("leaves loading ownership to the new workspace when refresh target drifts mid-flight", async () => {
    let releaseLoad: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const service: IHooksService = {
      async loadHooks(params) {
        if (params.workspacePath === "/workspace-a") {
          await gate;
          return { hooks: [], hooksEnabled: false };
        }
        return { hooks: [configuredHook()], hooksEnabled: true };
      },
      async saveHooks() {},
    };
    useHooksStore.setState({ workspacePath: "/workspace-a", workspaceIdentity: null });
    const refreshA = useHooksStore.getState().refresh(service, { workspacePath: "/workspace-a" });
    const initB = useHooksStore.getState().initialize("/workspace-b", undefined, service);
    releaseLoad?.();
    await Promise.all([refreshA, initB]);
    expect(useHooksStore.getState().loadedWorkspaceKey).toBe("/workspace-b");
    expect(useHooksStore.getState().loading).toBe(false);
  });
});

describe("resolveLatestReviewScopeTarget", () => {
  const tabs = [
    { workspacePath: "/local/repo", workspaceIdentity: undefined },
    { workspacePath: "/remote/repo", workspaceIdentity: "ssh://dev/remote/repo" },
  ];

  it("maps the latest binding to a known workspace scope key by identity", () => {
    const target = resolveLatestReviewScopeTarget(
      {
        s1: {
          request: {
            interactionId: "i-1",
            createdAt: 1,
            workspaceIdentity: "ssh://dev/remote/repo",
          },
          workspacePath: "/remote/repo",
        },
      },
      tabs,
    );
    expect(target).toEqual({ interactionId: "i-1", scopeKey: "ssh://dev/remote/repo" });
  });

  it("falls back to workspacePath matching only for identity-less legacy bindings", () => {
    const target = resolveLatestReviewScopeTarget(
      {
        s1: {
          request: { interactionId: "i-2", createdAt: 2, workspaceIdentity: undefined },
          workspacePath: "/local/repo",
        },
      },
      tabs,
    );
    expect(target).toEqual({ interactionId: "i-2", scopeKey: "/local/repo" });
  });

  it("picks the newest interaction when multiple bindings exist", () => {
    const target = resolveLatestReviewScopeTarget(
      {
        s1: {
          request: {
            interactionId: "i-old",
            createdAt: 1,
            workspaceIdentity: "ssh://dev/remote/repo",
          },
          workspacePath: "/remote/repo",
        },
        s2: {
          request: { interactionId: "i-new", createdAt: 5, workspaceIdentity: undefined },
          workspacePath: "/local/repo",
        },
      },
      tabs,
    );
    expect(target).toEqual({ interactionId: "i-new", scopeKey: "/local/repo" });
  });

  it("returns null when the binding workspace no longer exists in tabs", () => {
    const target = resolveLatestReviewScopeTarget(
      {
        s1: {
          request: { interactionId: "i-gone", createdAt: 3, workspaceIdentity: "ssh://gone/repo" },
          workspacePath: "/gone/repo",
        },
      },
      tabs,
    );
    expect(target).toBeNull();
  });

  it("returns null when there are no bindings", () => {
    expect(resolveLatestReviewScopeTarget({}, tabs)).toBeNull();
  });
});

function configuredHook(): Hook {
  return {
    id: "configured",
    event: "PreToolUse",
    matcher: "Write",
    type: "process",
    command: "node",
    args: ["hook.mjs"],
    enabled: true,
    location: {
      source: "cf",
      scope: "project",
      directoryPath: "/workspace/.cf",
      projectPath: "/workspace",
    },
  };
}

function workspaceConfiguredHook(
  trustState: NonNullable<NonNullable<Hook["workspaceHook"]>["trustState"]>,
): Hook {
  return {
    ...configuredHook(),
    workspaceHook: {
      reviewItemId: "configured",
      workspaceIdentity: "local:/workspace",
      bundleDigest: "b".repeat(64),
      hookDeclarationDigest: "a".repeat(64),
      sourceFileIndex: 0,
      sourceRootEnabled: true,
      declarationEnabled: true,
      runtimeHooksEnabled: true,
      configuredEnabled: true,
      sourcePath: ".cf/config.json",
      trustState,
    },
  };
}
