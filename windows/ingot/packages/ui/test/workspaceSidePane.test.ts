import { describe, expect, it } from "vitest";
import {
  activateBrowserSidePane,
  activateNewTabSidePane,
  activateSidePaneTab,
  activateDeveloperToolsSidePane,
  activatePluginMarketSidePane,
  applyBrowserUseSidePaneEvent,
  applyBrowserUseSidePaneVisibilityEvent,
  BROWSER_USE_OPERATION_INDICATOR_DURATION_MS,
  closeCodeViewerSidePane,
  closeOtherSidePaneTabs,
  closeSidePaneTab,
  getActiveSelectionSideChatTab,
  getActiveSidePaneTab,
  getVisibleSidePaneTabs,
  isSidePaneTabVisibleInScope,
  markBrowserUseSidePaneTabOperation,
  normalizeWorkspaceSidePaneState,
  openSelectionSideChatPane,
  openPlanDetailSidePane,
  openSubagentDirectorySidePane,
  openSubagentSessionSidePane,
  openWorkflowRunSidePane,
  openWorkflowActorSessionSidePane,
  openWorkflowArtifactSidePane,
  openWorkflowWorkspaceSidePane,
  openBrowserSidePane,
  openBrowserPermissionsSidePane,
  openBrowserUseSidePane,
  openOrActivateBrowserSidePaneByUrl,
  findBrowserSidePaneTabByUrl,
  openCodeViewerSidePane,
  openFileManagerSidePane,
  navigateFileManagerSidePane,
  openCodeViewerSidePanes,
  openTerminalSidePane,
  reorderSidePaneTab,
  resolveActiveTabForOwner,
  resolveSidePaneScopeState,
  restoreSidePaneTab,
  selectSidePaneTabsForScope,
  syncSubagentSessionSidePaneTabs,
  shouldMountSidePaneContent,
  applyBrowserTabResidencyEvent,
  restoreBrowserTabShells,
  stampSidePaneTabsOwnership,
  toggleBrowserSidePane,
  toggleGitSidePane,
  updateBrowserSidePaneTab,
  type WorkspaceSidePaneTab,
} from "../src/lib/workspaceSidePane.js";

describe("workspaceSidePane", () => {
  it("keeps a navigated file tab when reopening its original path", () => {
    const original = { type: "file", title: "one.ts", path: "/workspace/one.ts" } as const;
    const first = openCodeViewerSidePane(null, original);
    const tabId = first.activeTabId;
    const navigated = navigateFileManagerSidePane(first, tabId, {
      type: "file",
      title: "two.ts",
      path: "/workspace/two.ts",
    });
    const reopened = openCodeViewerSidePane(navigated, original);
    expect(reopened.tabs).toHaveLength(2);
    expect(reopened.tabs[0]).toMatchObject({ id: tabId, source: { path: "/workspace/two.ts" } });
    expect(reopened.activeTabId).not.toBe(tabId);
    expect(openCodeViewerSidePane(reopened, original).tabs).toHaveLength(2);
  });

  it("navigates only the requested file manager and preserves its task scope", () => {
    const target = {
      workspacePath: "/workspace",
      workspaceIdentity: "remote:one",
      workspaceRemoteSessionId: "session-one",
    };
    const first = stampSidePaneTabsOwnership(openFileManagerSidePane(null, target), {
      ownerTaskId: "task-one",
      workspaceKey: "remote:one",
    })!;
    const second = openFileManagerSidePane(first, target);
    const next = navigateFileManagerSidePane(second, first.activeTabId, {
      type: "file",
      title: "a.ts",
      path: "/workspace/a.ts",
    });
    expect(next?.activeTabId).toBe(second.activeTabId);
    expect(next?.tabs[0]).toMatchObject({
      id: first.activeTabId,
      ownerTaskId: "task-one",
      workspaceKey: "remote:one",
      target,
      source: { path: "/workspace/a.ts" },
    });
    expect(next?.tabs[1]).toMatchObject({ source: null });
  });

  it("NewTags页支持多开、重New激活与独立Close", () => {
    const first = activateNewTabSidePane(null);
    const second = activateNewTabSidePane(first);
    expect(second.tabs).toHaveLength(2);
    expect(second.tabs[0]!.id).not.toBe(second.tabs[1]!.id);
    expect(second.activeTabId).toBe(second.tabs[1]!.id);
    const focused = activateSidePaneTab(second, first.tabs[0]!);
    expect(focused.tabs).toHaveLength(2);
    expect(getActiveSidePaneTab(focused)?.id).toBe(first.activeTabId);
    const closed = closeSidePaneTab(focused, first.activeTabId);
    expect(closed?.activeTabId).toBe(second.activeTabId);
    expect(closeSidePaneTab(closed, second.activeTabId)).toBeNull();
  });

  it("NewTags页只属于创建时的Workspace与Chat", () => {
    const scope = { workspaceKey: "workspace-a", ownerTaskId: "task-a" };
    const state = stampSidePaneTabsOwnership(activateNewTabSidePane(null), scope)!;
    const tab = state.tabs[0]!;
    expect(isSidePaneTabVisibleInScope(tab, scope)).toBe(true);
    expect(isSidePaneTabVisibleInScope(tab, { ...scope, ownerTaskId: "task-b" })).toBe(false);
    expect(isSidePaneTabVisibleInScope(tab, { ...scope, workspaceKey: "workspace-b" })).toBe(false);
    expect(normalizeWorkspaceSidePaneState(state)).toEqual(state);
  });

  const viewerSource = {
    type: "file" as const,
    title: "demo.ts",
    path: "/workspace/demo.ts",
  };

  function withoutOpenedAt<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((item) => withoutOpenedAt(item)) as T;
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "openedAt")
          .map(([key, item]) => [key, withoutOpenedAt(item)]),
      ) as T;
    }

    return value;
  }

  it("折叠or切换Chat时仍为 Browser/browser-use Background挂载inner容", () => {
    expect(shouldMountSidePaneContent(false, [])).toBe(false);
    expect(shouldMountSidePaneContent(false, [{ id: "browser:human", type: "browser" }])).toBe(
      true,
    );
    expect(
      shouldMountSidePaneContent(false, [
        {
          id: "browser-use:tab-1",
          type: "browser-use",
          sessionId: "sess-1",
          tabId: "tab-1",
        },
      ]),
    ).toBe(true);
    expect(shouldMountSidePaneContent(true, [])).toBe(true);
  });

  it("BTL06: suspend 只卸载 guest，Retain logical tab shell；restore 保持 stable tabId", () => {
    const opened = stampSidePaneTabsOwnership(
      openBrowserSidePane(null, { tabId: "browser:stable" }),
      {
        ownerTaskId: "session-a",
        workspaceKey: "workspace-a",
      },
    );
    const suspended = applyBrowserTabResidencyEvent(opened, {
      tabId: "browser:stable",
      generation: 3,
      residency: "suspended",
    });

    expect(suspended).toMatchObject({
      activeTabId: "browser:stable",
      tabs: [
        {
          id: "browser:stable",
          residency: "suspended",
          residencyGeneration: 3,
        },
      ],
    });
    expect(
      applyBrowserTabResidencyEvent(suspended, {
        tabId: "browser:stable",
        generation: 4,
        residency: "restoring",
      }),
    ).toMatchObject({
      tabs: [
        {
          id: "browser:stable",
          residency: "restoring",
          residencyGeneration: 4,
        },
      ],
    });
  });

  it("Deny迟到 generation，跨重启 shell Default以 suspended 恢复且不覆盖Other scope", () => {
    const current = applyBrowserTabResidencyEvent(
      stampSidePaneTabsOwnership(openBrowserSidePane(null, { tabId: "browser:stable" }), {
        ownerTaskId: "session-a",
        workspaceKey: "workspace-a",
      }),
      {
        tabId: "browser:stable",
        generation: 7,
        residency: "restoring",
      },
    );
    expect(
      applyBrowserTabResidencyEvent(current, {
        tabId: "browser:stable",
        generation: 6,
        residency: "suspended",
      }),
    ).toBe(current);

    const restored = restoreBrowserTabShells(current, [
      {
        tabId: "browser:restored",
        workspaceKey: "workspace-a",
        sessionId: "session-a",
        browserId: "browser-restored-real",
        browserGeneration: 9,
        origin: "user",
        restoreUrl: "https://example.com/restored",
        title: "Restored",
        faviconUrl: null,
        openedAt: 2,
        lastSelectedAt: null,
      },
    ]);
    expect(restored.tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser:restored",
          ownerTaskId: "session-a",
          residency: "suspended",
          initialUrl: "https://example.com/restored",
        }),
      ]),
    );
  });

  it("BTL17/18: restore terminal live 收敛Status，并Retain冷恢复的真实 browser identity", () => {
    const restored = restoreBrowserTabShells(null, [
      {
        tabId: "browser:agent-restored",
        workspaceKey: "workspace-a",
        sessionId: "session-a",
        browserId: "browser-real",
        browserGeneration: 7,
        origin: "agent",
        restoreUrl: "https://example.com/restored",
        title: "Restored",
        faviconUrl: null,
        openedAt: 2,
        lastSelectedAt: 10,
      },
    ]);
    const restoring = applyBrowserTabResidencyEvent(restored, {
      tabId: "browser:agent-restored",
      workspaceKey: "workspace-a",
      sessionId: "session-a",
      browserId: "browser-real",
      browserGeneration: 7,
      generation: 3,
      residency: "restoring",
    });
    const live = applyBrowserTabResidencyEvent(restoring, {
      tabId: "browser:agent-restored",
      workspaceKey: "workspace-a",
      sessionId: "session-a",
      browserId: "browser-real",
      browserGeneration: 7,
      generation: 3,
      residency: "live-background",
    });

    expect(live?.tabs[0]).toMatchObject({
      browserId: "browser-real",
      browserGeneration: 7,
      residency: "live-background",
      residencyGeneration: 3,
    });
  });

  it("BTL22: 冷恢复保持 openedAt 顺序，但激活Current scope 最后选Medium的 tab", () => {
    const restored = restoreBrowserTabShells(
      null,
      [
        {
          tabId: "browser:first",
          workspaceKey: "workspace-a",
          sessionId: "session-a",
          browserId: "unclaimed-iab",
          browserGeneration: 0,
          origin: "user",
          restoreUrl: "https://example.com/first",
          title: "First",
          faviconUrl: null,
          openedAt: 1,
          lastSelectedAt: 100,
        },
        {
          tabId: "browser:last-selected",
          workspaceKey: "workspace-a",
          sessionId: "session-a",
          browserId: "unclaimed-iab",
          browserGeneration: 0,
          origin: "user",
          restoreUrl: "https://example.com/last",
          title: "Last",
          faviconUrl: null,
          openedAt: 2,
          lastSelectedAt: 500,
        },
      ],
      {
        workspaceKey: "workspace-a",
        sessionId: "session-a",
      },
    );

    expect(restored.tabs.map((tab) => tab.id)).toEqual(["browser:first", "browser:last-selected"]);
    expect(restored.activeTabId).toBe("browser:last-selected");
  });

  it("BTL22: Draft态 unscoped 持久Value恢复为 null owner，保持CurrentDraft可见", () => {
    const restored = restoreBrowserTabShells(
      null,
      [
        {
          tabId: "browser:draft",
          workspaceKey: "workspace-a",
          sessionId: "unscoped",
          browserId: "unclaimed-iab",
          browserGeneration: 0,
          origin: "user",
          restoreUrl: "https://example.com/draft",
          title: "Draft",
          faviconUrl: null,
          openedAt: 1,
          lastSelectedAt: 100,
        },
      ],
      {
        workspaceKey: "workspace-a",
        sessionId: "unscoped",
      },
    );

    expect(restored.tabs[0]).toMatchObject({ ownerTaskId: null });
    expect(
      getVisibleSidePaneTabs(restored.tabs, {
        workspaceKey: "workspace-a",
        ownerTaskId: null,
      }),
    ).toHaveLength(1);
  });

  it("opens browser pane from closed state", () => {
    const next = toggleBrowserSidePane(null);

    expect(next).not.toBeNull();
    if (!next) {
      throw new Error("Expected browser side pane state");
    }
    expect(next.activeTabId).toMatch(/^browser:/);
    expect(withoutOpenedAt(next.tabs)).toEqual([
      {
        id: next.activeTabId,
        type: "browser",
        faviconUrl: null,
        initialUrl: null,
        title: null,
      },
    ]);
  });

  it("filters hidden treemapping tabs and keeps a visible active tab", () => {
    expect(
      withoutOpenedAt(
        normalizeWorkspaceSidePaneState({
          activeTabId: "treemapping",
          tabs: [
            { id: "git", type: "git" },
            { id: "treemapping", type: "treemapping" },
          ],
        }),
      ),
    ).toEqual({
      activeTabId: "git",
      tabs: [{ id: "git", type: "git" }],
    });
  });

  it("backfills missing selection side chat ordinals without disturbing existing ones", () => {
    const legacyTab = {
      id: "selection-side-chat:ws:parent-a:child-legacy",
      type: "selection-side-chat",
      workspaceKey: "ws",
      workspacePath: "/ws",
      parentSessionId: "parent-a",
      childSessionId: "child-legacy",
    } as unknown as WorkspaceSidePaneTab & { type: "selection-side-chat" };
    const modernTab = {
      ...legacyTab,
      id: "selection-side-chat:ws:parent-a:child-modern",
      childSessionId: "child-modern",
      ordinal: 1,
    };
    const otherParentLegacyTab = {
      ...legacyTab,
      id: "selection-side-chat:ws:parent-b:child-other",
      parentSessionId: "parent-b",
      childSessionId: "child-other",
    };

    const normalized = normalizeWorkspaceSidePaneState({
      activeTabId: modernTab.id,
      tabs: [legacyTab, modernTab, otherParentLegacyTab],
    });

    const ordinals = new Map(
      (normalized?.tabs ?? []).flatMap((tab) =>
        tab.type === "selection-side-chat" ? [[tab.childSessionId, tab.ordinal]] : [],
      ),
    );
    expect(ordinals.get("child-modern")).toBe(1);
    expect(ordinals.get("child-legacy")).toBe(2);
    expect(ordinals.get("child-other")).toBe(1);
    expect(normalized?.activeTabId).toBe(modernTab.id);
  });

  it("preserves an intentionally empty active tab while only hidden parent tabs remain", () => {
    const state = openSubagentSessionSidePane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      rootSessionId: "parent-a",
      parentSessionId: "parent-a",
      childSessionId: "child-a",
      subagentType: "Explore",
      title: "Explore project structure",
    });
    expect(normalizeWorkspaceSidePaneState({ ...state, activeTabId: "" })?.activeTabId).toBe("");
  });

  it("groups child detail tabs by root session and reuses a child across nesting levels", () => {
    const first = openSubagentSessionSidePane(null, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      rootSessionId: "root-a",
      parentSessionId: "parent-a",
      childSessionId: "child-a",
      subagentType: "Explore",
      title: "Inspect files",
    });
    const second = openSubagentSessionSidePane(first, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      rootSessionId: "root-a",
      parentSessionId: "nested-parent",
      childSessionId: "child-a",
      subagentType: "Explore",
      title: "Inspect files again",
    });

    expect(second.tabs).toHaveLength(1);
    expect(second.tabs[0]).toMatchObject({
      id: "subagent-session:ssh%3A%2F%2Fhost%2Fworkspace:root-a:child-a",
      rootSessionId: "root-a",
      parentSessionId: "nested-parent",
      childSessionId: "child-a",
      title: "Inspect files again",
    });
  });

  it("opens one reusable subagent directory per workspace and root parent", () => {
    const first = openSubagentDirectorySidePane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      rootSessionId: "root-a",
      parentSessionId: "parent-a",
    });
    const second = openSubagentDirectorySidePane(first, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      rootSessionId: "root-a",
      parentSessionId: "parent-a",
    });

    expect(second.tabs).toHaveLength(1);
    expect(second).toMatchObject({
      activeTabId: "subagent-directory:%2Fworkspace:root-a:parent-a",
      tabs: [
        {
          type: "subagent-directory",
          rootSessionId: "root-a",
          parentSessionId: "parent-a",
        },
      ],
    });
  });

  it("drops invalid child tabs without closing the directory and falls back to it", () => {
    const directory = openSubagentDirectorySidePane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      rootSessionId: "root-a",
      parentSessionId: "parent-a",
    });
    const withValid = openSubagentSessionSidePane(directory, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      rootSessionId: "root-a",
      parentSessionId: "parent-a",
      childSessionId: "child-valid",
      subagentType: "Explore",
      title: "Valid",
    });
    const withInvalid = openSubagentSessionSidePane(withValid, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      rootSessionId: "root-a",
      parentSessionId: "parent-a",
      childSessionId: "child-old-branch",
      subagentType: "Explore",
      title: "Old branch",
    });

    const next = syncSubagentSessionSidePaneTabs(withInvalid, {
      rootSessionId: "root-a",
      parentSessionId: "parent-a",
      validChildSessionIds: ["child-valid"],
    });

    expect(next?.tabs.map((tab) => tab.id)).toEqual([
      "subagent-directory:%2Fworkspace:root-a:parent-a",
      "subagent-session:%2Fworkspace:root-a:child-valid",
    ]);
    expect(next?.activeTabId).toBe("subagent-directory:%2Fworkspace:root-a:parent-a");
  });

  it("按 childSessionId 多开 selection side chat tab，并为同父Instance分配序Number", () => {
    const first = openSelectionSideChatPane(null, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      parentSessionId: "parent-a",
      childSessionId: "child-a",
    });
    const second = openSelectionSideChatPane(first, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      parentSessionId: "parent-a",
      childSessionId: "child-b",
    });
    const reopenedFirst = openSelectionSideChatPane(second, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      parentSessionId: "parent-a",
      childSessionId: "child-a",
    });

    expect(second.tabs).toHaveLength(2);
    expect(second.tabs).toMatchObject([
      {
        id: "selection-side-chat:ssh%3A%2F%2Fhost%2Fworkspace:parent-a:child-a",
        type: "selection-side-chat",
        parentSessionId: "parent-a",
        childSessionId: "child-a",
        ordinal: 1,
      },
      {
        id: "selection-side-chat:ssh%3A%2F%2Fhost%2Fworkspace:parent-a:child-b",
        type: "selection-side-chat",
        parentSessionId: "parent-a",
        childSessionId: "child-b",
        ordinal: 2,
      },
    ]);
    expect(reopenedFirst.tabs).toHaveLength(2);
    expect(reopenedFirst.activeTabId).toBe(
      "selection-side-chat:ssh%3A%2F%2Fhost%2Fworkspace:parent-a:child-a",
    );
    expect(reopenedFirst.tabs[0]).toMatchObject({
      childSessionId: "child-a",
      ordinal: 1,
    });
  });

  it("只把Current active 且属于同 workspace + parent 的Assist tab 解析为划词Target", () => {
    const first = openSelectionSideChatPane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      childSessionId: "child-a",
    });
    const second = openSelectionSideChatPane(first, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      childSessionId: "child-b",
    });
    expect(
      getActiveSelectionSideChatTab(second, {
        workspaceKey: "/workspace",
        parentSessionId: "parent-a",
      }),
    ).toMatchObject({ childSessionId: "child-b" });

    const browserActive = openBrowserSidePane(second, {
      tabId: "browser:active",
    });
    expect(
      getActiveSelectionSideChatTab(browserActive, {
        workspaceKey: "/workspace",
        parentSessionId: "parent-a",
      }),
    ).toBeNull();
    expect(
      getActiveSelectionSideChatTab(second, {
        workspaceKey: "/other",
        parentSessionId: "parent-a",
      }),
    ).toBeNull();
  });

  it("按 workspace identity + parent + toolCall 复用并IsolatedPlanDetails tab", () => {
    const first = openPlanDetailSidePane(null, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-plan-a",
      markdown: "# 计划 A",
    });
    const refreshed = openPlanDetailSidePane(first, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-plan-a",
      markdown: "# Plan A\n\n已更New",
    });
    const second = openPlanDetailSidePane(refreshed, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-plan-b",
      markdown: "# 计划 B",
    });

    expect(second.tabs).toHaveLength(2);
    expect(second.tabs[0]).toMatchObject({
      type: "plan-detail",
      toolCallId: "tool-plan-a",
      markdown: "# Plan A\n\n已更New",
    });
    expect(second.tabs[1]).toMatchObject({
      type: "plan-detail",
      toolCallId: "tool-plan-b",
    });
    expect(
      getVisibleSidePaneTabs(second.tabs, {
        workspaceKey: second.tabs[0]!.workspaceKey ?? null,
        ownerTaskId: "parent-a",
      }),
    ).toHaveLength(2);
    expect(
      getVisibleSidePaneTabs(second.tabs, {
        workspaceKey: second.tabs[0]!.workspaceKey ?? null,
        ownerTaskId: "parent-b",
      }),
    ).toHaveLength(0);
  });

  it("run Details tab 的落点（追记「五枚药丸与One扇门」）：随Request落、再开不带就删键、openedAt Refresh", () => {
    const base = {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf-1",
      runId: "dwfrun-a",
    };
    const first = openWorkflowRunSidePane(null, {
      ...base,
      workflowName: "Fan-out review",
      phaseId: "phase#a",
    });
    expect(first.tabs).toHaveLength(1);
    expect(first.tabs[0]).toMatchObject({
      type: "workflow-run",
      focusPhaseId: "phase#a",
      workflowName: "Fan-out review",
    });
    const openedAt = (first.tabs[0] as { openedAt?: number }).openedAt!;
    const relanded = openWorkflowRunSidePane(first, { ...base, phaseId: "phase#b" });
    expect(relanded.tabs).toHaveLength(1);
    expect(relanded.tabs[0]).toMatchObject({
      focusPhaseId: "phase#b",
      workflowName: "Fan-out review",
    });
    expect((relanded.tabs[0] as { openedAt?: number }).openedAt).toBeGreaterThanOrEqual(openedAt);
    const unlanded = openWorkflowRunSidePane(relanded, base);
    expect(unlanded.tabs).toHaveLength(1);
    expect(unlanded.tabs[0]).not.toHaveProperty("focusPhaseId");
  });

  it("按 workspace identity + parent + run 复用并Isolated workflow run Details tab", () => {
    const first = openWorkflowRunSidePane(null, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      remoteSessionId: "remote-1",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf-a",
      runId: "dwfrun-a",
      workflowName: "Three路评审",
    });
    const reclicked = openWorkflowRunSidePane(first, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      remoteSessionId: "remote-1",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf-a",
      runId: "dwfrun-a",
      workflowName: "Three路评审（Rename）",
    });
    const secondRun = openWorkflowRunSidePane(reclicked, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      remoteSessionId: "remote-1",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf-b",
      runId: "dwfrun-b",
    });

    expect(reclicked.tabs).toHaveLength(1);
    expect(reclicked.activeTabId).toBe(
      "workflow-run:ssh%3A%2F%2Fhost%2Fworkspace:parent-a:dwfrun-a",
    );
    expect(reclicked.tabs[0]).toMatchObject({
      type: "workflow-run",
      runId: "dwfrun-a",
      toolCallId: "tool-wf-a",
      workflowName: "Three路评审（Rename）",
      remoteSessionId: "remote-1",
    });

    expect(secondRun.tabs).toHaveLength(2);
    expect(secondRun.tabs[1]).toMatchObject({
      id: "workflow-run:ssh%3A%2F%2Fhost%2Fworkspace:parent-a:dwfrun-b",
      type: "workflow-run",
      runId: "dwfrun-b",
    });
    expect(
      getVisibleSidePaneTabs(secondRun.tabs, {
        workspaceKey: secondRun.tabs[0]!.workspaceKey ?? null,
        ownerTaskId: "parent-a",
      }),
    ).toHaveLength(2);
    expect(
      getVisibleSidePaneTabs(secondRun.tabs, {
        workspaceKey: secondRun.tabs[0]!.workspaceKey ?? null,
        ownerTaskId: "parent-b",
      }),
    ).toHaveLength(0);
  });

  it("同One个 runId 在不同 workspace / 不同 parent 下互不复用", () => {
    const inWorkspaceA = openWorkflowRunSidePane(null, {
      workspaceKey: "/workspace-a",
      workspacePath: "/workspace-a",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf",
      runId: "dwfrun-1",
    });
    const inWorkspaceB = openWorkflowRunSidePane(inWorkspaceA, {
      workspaceKey: "/workspace-b",
      workspacePath: "/workspace-b",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf",
      runId: "dwfrun-1",
    });
    const inOtherParent = openWorkflowRunSidePane(inWorkspaceB, {
      workspaceKey: "/workspace-a",
      workspacePath: "/workspace-a",
      parentSessionId: "parent-b",
      toolCallId: "tool-wf",
      runId: "dwfrun-1",
    });

    expect(inOtherParent.tabs).toHaveLength(3);
    expect(new Set(inOtherParent.tabs.map((tab) => tab.id)).size).toBe(3);
  });

  it("workflow run tab 不Yes workspace 全局 tab，且 8-run 淘汰不回收它", () => {
    const state = openWorkflowRunSidePane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf",
      runId: "dwfrun-1",
    });
    const tab = state.tabs[0]!;
    expect(
      isSidePaneTabVisibleInScope(tab, {
        workspaceKey: tab.workspaceKey ?? null,
        ownerTaskId: "parent-a",
      }),
    ).toBe(true);
    expect(
      isSidePaneTabVisibleInScope(tab, {
        workspaceKey: tab.workspaceKey ?? null,
        ownerTaskId: "parent-b",
      }),
    ).toBe(false);

    expect(
      syncSubagentSessionSidePaneTabs(state, {
        rootSessionId: "parent-a",
        parentSessionId: "parent-a",
        validChildSessionIds: [],
      }),
    ).toBe(state);
  });

  it("切回Chat时优先激活 workflow run tab（与 plan-detail 同档）", () => {
    const withBrowser = openBrowserSidePane(null, { tabId: "browser:1" });
    const withRun = openWorkflowRunSidePane(withBrowser, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf",
      runId: "dwfrun-1",
    });
    const selected = selectSidePaneTabsForScope(
      { ...withRun, activeTabId: "missing" },
      { workspaceKey: "/workspace", ownerTaskId: "parent-a" },
    );
    expect(selected?.activeTabId).toBe("workflow-run:%2Fworkspace:parent-a:dwfrun-1");
  });

  // ── actor transcript tab（docs/dynamic-workflow/presentation.md「Subagent transcripts」）──
  it("按 workspace + parent + run + 槽位复用 actor transcript tab，重复点击幂等", () => {
    const first = openWorkflowActorSessionSidePane(null, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      remoteSessionId: "remote-1",
      parentSessionId: "parent-a",
      runId: "dwfrun-a",
      actorSessionId: "dwf-dwfrun-a-actor_1@1",
      siteId: "actor#1",
      ordinal: 1,
      actorName: "reviewer",
    });
    const reclicked = openWorkflowActorSessionSidePane(first, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      remoteSessionId: "remote-1",
      parentSessionId: "parent-a",
      runId: "dwfrun-a",
      actorSessionId: "dwf-dwfrun-a-actor_1@1",
      siteId: "actor#1",
      ordinal: 1,
      actorName: "reviewer",
    });
    const sibling = openWorkflowActorSessionSidePane(reclicked, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      remoteSessionId: "remote-1",
      parentSessionId: "parent-a",
      runId: "dwfrun-a",
      actorSessionId: "dwf-dwfrun-a-actor_1@2",
      siteId: "actor#1",
      ordinal: 2,
      actorName: "reviewer",
    });

    expect(reclicked.tabs).toHaveLength(1);
    expect(reclicked.activeTabId).toBe(
      "workflow-actor-session:ssh%3A%2F%2Fhost%2Fworkspace:parent-a:dwfrun-a:actor%231%401",
    );
    expect(reclicked.tabs[0]).toMatchObject({
      type: "workflow-actor-session",
      parentSessionId: "parent-a",
      runId: "dwfrun-a",
      actorSessionId: "dwf-dwfrun-a-actor_1@1",
      siteId: "actor#1",
      ordinal: 1,
      actorName: "reviewer",
      remoteSessionId: "remote-1",
    });
    expect(sibling.tabs).toHaveLength(2);
    expect(sibling.activeTabId).toContain("actor%231%402");
  });

  it("槽位 tab：先从未Start的药丸开（无Session id），后从Started的药丸再开Yes同One个 tab 并补上Session id", () => {
    // docs/dynamic-workflow/presentation.md「The pill」。
    const base = {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-a",
      siteId: "actor#1",
      ordinal: 1,
      actorName: "reviewer",
    };
    const slot = openWorkflowActorSessionSidePane(null, base);
    expect(slot.tabs).toHaveLength(1);
    expect(slot.tabs[0]).not.toHaveProperty("actorSessionId");
    expect(slot.tabs[0]).toMatchObject({ runId: "dwfrun-a", siteId: "actor#1", ordinal: 1 });

    const started = openWorkflowActorSessionSidePane(slot, {
      ...base,
      actorSessionId: "dwf-dwfrun-a-actor_1@1",
    });
    expect(started.tabs).toHaveLength(1);
    expect(started.tabs[0]!.id).toBe(slot.tabs[0]!.id);
    expect(started.tabs[0]).toMatchObject({ actorSessionId: "dwf-dwfrun-a-actor_1@1" });

    const again = openWorkflowActorSessionSidePane(started, base);
    expect(again.tabs).toHaveLength(1);
    expect(again.tabs[0]).toMatchObject({ actorSessionId: "dwf-dwfrun-a-actor_1@1" });
    const otherRun = openWorkflowActorSessionSidePane(again, { ...base, runId: "dwfrun-b" });
    expect(otherRun.tabs).toHaveLength(2);
  });

  it("actor transcript tab 按所属Chat收窄可见性，且不Yes workspace 全局 tab", () => {
    const state = openWorkflowActorSessionSidePane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      actorSessionId: "dwf-dwfrun-1-actor_1@1",
      siteId: "actor#1",
      ordinal: 1,
    });
    const tab = state.tabs[0]!;

    expect(
      isSidePaneTabVisibleInScope(tab, {
        workspaceKey: tab.workspaceKey ?? null,
        ownerTaskId: "parent-a",
      }),
    ).toBe(true);
    expect(
      isSidePaneTabVisibleInScope(tab, {
        workspaceKey: tab.workspaceKey ?? null,
        ownerTaskId: "parent-b",
      }),
    ).toBe(false);
    expect(
      getVisibleSidePaneTabs(state.tabs, {
        workspaceKey: state.tabs[0]!.workspaceKey ?? null,
        ownerTaskId: "parent-a",
      }),
    ).toHaveLength(1);
    expect(
      getVisibleSidePaneTabs(state.tabs, {
        workspaceKey: state.tabs[0]!.workspaceKey ?? null,
        ownerTaskId: "parent-b",
      }),
    ).toHaveLength(0);
    expect(
      resolveActiveTabForOwner(state, { ownerTaskId: "parent-a", workspaceKey: "/workspace" }),
    ).toBe(tab.id);
    expect(
      resolveActiveTabForOwner(state, { ownerTaskId: "parent-b", workspaceKey: "/workspace" }),
    ).toBeNull();
  });

  it("Sub-session那套回收绝不吃 actor transcript tab", () => {
    const state = openWorkflowActorSessionSidePane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      actorSessionId: "dwf-dwfrun-1-actor_1@1",
      siteId: "actor#1",
      ordinal: 1,
    });

    expect(
      syncSubagentSessionSidePaneTabs(state, {
        rootSessionId: "parent-a",
        parentSessionId: "parent-a",
        validChildSessionIds: [],
      }),
    ).toBe(state);
    expect(
      syncSubagentSessionSidePaneTabs(state, {
        rootSessionId: "parent-a",
        parentSessionId: "parent-a",
        validChildSessionIds: ["dwf-dwfrun-1-actor_1@1"],
      }),
    ).toBe(state);
  });

  it("切回Chat时 actor transcript tab 与 workflow run 同档参与优先激活", () => {
    const withBrowser = openBrowserSidePane(null, { tabId: "browser:1" });
    const withActor = openWorkflowActorSessionSidePane(withBrowser, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      actorSessionId: "dwf-dwfrun-1-actor_1@1",
      siteId: "actor#1",
      ordinal: 1,
    });
    const selected = selectSidePaneTabsForScope(
      { ...withActor, activeTabId: "missing" },
      { workspaceKey: "/workspace", ownerTaskId: "parent-a" },
    );
    expect(selected?.activeTabId).toContain("workflow-actor-session:");
  });

  it("身份Yes (workspace, 父Session, run, 产物 id)——**不含Version**，同One产物再点只聚焦同One个 tab", () => {
    const first = openWorkflowArtifactSidePane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "book",
      version: 1,
      title: "审计报告",
    });
    const reclicked = openWorkflowArtifactSidePane(first, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "book",
      title: "审计报告",
    });

    expect(first.tabs).toHaveLength(1);
    expect(reclicked.tabs).toHaveLength(1);
    expect(reclicked.activeTabId).toBe("workflow-artifact:%2Fworkspace:parent-a:dwfrun-1:book");
    expect(reclicked.tabs[0]).toMatchObject({
      type: "workflow-artifact",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "book",
      title: "审计报告",
    });
    expect("version" in reclicked.tabs[0]!).toBe(false);

    const sibling = openWorkflowArtifactSidePane(reclicked, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "perf",
    });
    expect(sibling.tabs).toHaveLength(2);
  });

  it("显式带Version时那One版才Yes落点", () => {
    const first = openWorkflowArtifactSidePane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "book",
    });
    const pinned = openWorkflowArtifactSidePane(first, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "book",
      version: 2,
    });
    expect(pinned.tabs).toHaveLength(1);
    expect(pinned.tabs[0]).toMatchObject({ version: 2 });
  });

  it("产物 tab 按所属Chat收窄可见性，且不Yes workspace 全局 tab", () => {
    const state = openWorkflowArtifactSidePane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "book",
    });
    const tab = state.tabs[0]!;

    expect(
      isSidePaneTabVisibleInScope(tab, {
        workspaceKey: tab.workspaceKey ?? null,
        ownerTaskId: "parent-a",
      }),
    ).toBe(true);
    expect(
      isSidePaneTabVisibleInScope(tab, {
        workspaceKey: tab.workspaceKey ?? null,
        ownerTaskId: "parent-b",
      }),
    ).toBe(false);
    expect(
      getVisibleSidePaneTabs(state.tabs, {
        workspaceKey: state.tabs[0]!.workspaceKey ?? null,
        ownerTaskId: "parent-a",
      }),
    ).toHaveLength(1);
    expect(
      getVisibleSidePaneTabs(state.tabs, {
        workspaceKey: state.tabs[0]!.workspaceKey ?? null,
        ownerTaskId: "parent-b",
      }),
    ).toHaveLength(0);
  });

  it("Sub-session那套回收绝不吃产物 tab（产物的Character节Publish即钉住，run 被淘汰也还看得见）", () => {
    const state = openWorkflowArtifactSidePane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "book",
    });
    expect(
      syncSubagentSessionSidePaneTabs(state, {
        rootSessionId: "parent-a",
        parentSessionId: "parent-a",
        validChildSessionIds: [],
      }),
    ).toBe(state);
  });

  it("切回Chat时产物 tab 与 workflow run 同档参与优先激活", () => {
    const withBrowser = openBrowserSidePane(null, { tabId: "browser:1" });
    const withArtifact = openWorkflowArtifactSidePane(withBrowser, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "book",
    });
    const selected = selectSidePaneTabsForScope(
      { ...withArtifact, activeTabId: "missing" },
      { workspaceKey: "/workspace", ownerTaskId: "parent-a" },
    );
    expect(selected?.activeTabId).toContain("workflow-artifact:");
  });

  it("Remote workspace 的产物 tab 按 workspaceIdentity 建 key，并留住 remoteSessionId", () => {
    const state = openWorkflowArtifactSidePane(null, {
      workspaceKey: "ssh://host/workspace",
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      remoteSessionId: "remote-1",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "book",
    });
    expect(state.activeTabId).toBe(
      "workflow-artifact:ssh%3A%2F%2Fhost%2Fworkspace:parent-a:dwfrun-1:book",
    );
    expect(state.tabs[0]).toMatchObject({
      workspaceIdentity: "ssh://host/workspace",
      remoteSessionId: "remote-1",
    });
  });

  it("身份Yes (workspace, 父Session, run)——One个 run One份脚本 transcript；再点只聚焦并重New落点", () => {
    const first = openWorkflowWorkspaceSidePane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf-1",
      runId: "dwfrun-a",
      workflowName: "Fan-out review",
      phaseId: "phase#a",
    });
    expect(first.tabs).toHaveLength(1);
    expect(first.activeTabId).toBe("workflow-workspace:%2Fworkspace:parent-a:dwfrun-a");
    expect(first.tabs[0]).toMatchObject({
      type: "workflow-workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf-1",
      runId: "dwfrun-a",
      workflowName: "Fan-out review",
      focusPhaseId: "phase#a",
    });

    const relanded = openWorkflowWorkspaceSidePane(first, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf-1",
      runId: "dwfrun-a",
      phaseId: "phase#b",
    });
    expect(relanded.tabs).toHaveLength(1);
    expect(relanded.tabs[0]).toMatchObject({
      focusPhaseId: "phase#b",
      workflowName: "Fan-out review",
    });

    const unlanded = openWorkflowWorkspaceSidePane(relanded, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf-1",
      runId: "dwfrun-a",
    });
    expect(unlanded.tabs).toHaveLength(1);
    expect(unlanded.tabs[0]).not.toHaveProperty("focusPhaseId");

    const otherRun = openWorkflowWorkspaceSidePane(unlanded, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf-2",
      runId: "dwfrun-b",
    });
    expect(otherRun.tabs).toHaveLength(2);
  });

  it("脚本 transcript tab 按所属Chat收窄可见性，且不Yes workspace 全局 tab", () => {
    const state = openWorkflowWorkspaceSidePane(null, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf-1",
      runId: "dwfrun-1",
    });
    const tab = state.tabs[0]!;
    expect(
      isSidePaneTabVisibleInScope(tab, {
        workspaceKey: tab.workspaceKey ?? null,
        ownerTaskId: "parent-a",
      }),
    ).toBe(true);
    expect(
      isSidePaneTabVisibleInScope(tab, {
        workspaceKey: tab.workspaceKey ?? null,
        ownerTaskId: "parent-b",
      }),
    ).toBe(false);
    expect(
      getVisibleSidePaneTabs(state.tabs, {
        workspaceKey: state.tabs[0]!.workspaceKey ?? null,
        ownerTaskId: "parent-a",
      }),
    ).toHaveLength(1);
    expect(
      getVisibleSidePaneTabs(state.tabs, {
        workspaceKey: state.tabs[0]!.workspaceKey ?? null,
        ownerTaskId: "parent-b",
      }),
    ).toHaveLength(0);
  });

  it("Sub-session那套回收绝不吃脚本 transcript tab；切回Chat时它与 workflow run 同档参与优先激活", () => {
    const withBrowser = openBrowserSidePane(null, { tabId: "browser:1" });
    const state = openWorkflowWorkspaceSidePane(withBrowser, {
      workspaceKey: "/workspace",
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf-1",
      runId: "dwfrun-1",
    });
    expect(
      syncSubagentSessionSidePaneTabs(state, {
        rootSessionId: "parent-a",
        parentSessionId: "parent-a",
        validChildSessionIds: [],
      }),
    ).toBe(state);
    const selected = selectSidePaneTabsForScope(
      { ...state, activeTabId: "missing" },
      { workspaceKey: "/workspace", ownerTaskId: "parent-a" },
    );
    expect(selected?.activeTabId).toContain("workflow-workspace:");
  });

  it("reuses the developer tools tab", () => {
    const first = activateDeveloperToolsSidePane(null);
    const second = activateDeveloperToolsSidePane(first);

    expect(withoutOpenedAt(second)).toEqual({
      activeTabId: "developer-tools",
      tabs: [
        {
          id: "developer-tools",
          type: "developer-tools",
        },
      ],
    });
  });

  it("reuses the plugin market tab and preserves other panels", () => {
    const first = activatePluginMarketSidePane(activateDeveloperToolsSidePane(null));
    const second = activatePluginMarketSidePane(first);
    expect(second.tabs.map((tab) => tab.type)).toEqual(["developer-tools", "plugin-market"]);
    expect(second.activeTabId).toBe("plugin-market");
  });

  it("keeps browser and code viewer side by side and activates browser", () => {
    const current = openCodeViewerSidePane(null, viewerSource);

    const next = toggleBrowserSidePane(current);

    expect(next).not.toBeNull();
    if (!next) {
      throw new Error("Expected browser side pane state");
    }
    expect(next.activeTabId).toMatch(/^browser:/);
    expect(withoutOpenedAt(next)).toEqual({
      activeTabId: next.activeTabId,
      tabs: [
        {
          id: "code-viewer:file:/workspace/demo.ts",
          type: "code-viewer",
          source: viewerSource,
          sourceKey: "file:/workspace/demo.ts",
        },
        {
          id: next.activeTabId,
          type: "browser",
          faviconUrl: null,
          initialUrl: null,
          title: null,
        },
      ],
    });
  });

  it("closes browser pane when toggled again and keeps other tabs", () => {
    const current = activateBrowserSidePane(openCodeViewerSidePane(null, viewerSource), {
      tabId: "browser:a",
    });

    expect(withoutOpenedAt(toggleBrowserSidePane(current))).toEqual({
      activeTabId: "code-viewer:file:/workspace/demo.ts",
      tabs: [
        {
          id: "code-viewer:file:/workspace/demo.ts",
          type: "code-viewer",
          source: viewerSource,
          sourceKey: "file:/workspace/demo.ts",
        },
      ],
    });
  });

  it("only closes code viewer pane for code viewer state", () => {
    const viewerState = openCodeViewerSidePane(null, viewerSource);

    expect(closeCodeViewerSidePane(viewerState)).toBeNull();
    expect(
      withoutOpenedAt(
        closeCodeViewerSidePane({
          activeTabId: "browser:a",
          tabs: [{ id: "browser:a", type: "browser" }],
        }),
      ),
    ).toEqual({
      activeTabId: "browser:a",
      tabs: [{ id: "browser:a", type: "browser" }],
    });
  });

  it("can open multiple browser tabs", () => {
    const first = openBrowserSidePane(null, {
      tabId: "browser:a",
      initialUrl: "https://example.com/a",
    });
    const second = openBrowserSidePane(first, {
      tabId: "browser:b",
      initialUrl: "https://example.com/b",
    });

    expect(withoutOpenedAt(second)).toEqual({
      activeTabId: "browser:b",
      tabs: [
        {
          id: "browser:a",
          type: "browser",
          faviconUrl: null,
          initialUrl: "https://example.com/a",
          title: null,
        },
        {
          id: "browser:b",
          type: "browser",
          faviconUrl: null,
          initialUrl: "https://example.com/b",
          title: null,
        },
      ],
    });
  });

  it("RetainModel popup Label记，供ViewSkip human viewport 偏OK", () => {
    const state = openBrowserSidePane(null, {
      tabId: "browser:agent-popup",
      initialUrl: "https://example.com/next",
      agentOpened: true,
    });

    expect(state.tabs[0]).toMatchObject({
      id: "browser:agent-popup",
      type: "browser",
      agentOpened: true,
    });
  });

  it("can open multiple terminal tabs with workspace titles", () => {
    const first = openTerminalSidePane(null, { title: "z-code" });
    const second = openTerminalSidePane(first, { title: "z-code 2" });

    expect(withoutOpenedAt(second)).toEqual({
      activeTabId: second.activeTabId,
      tabs: [
        {
          id: first.activeTabId,
          type: "terminal",
          title: "z-code",
        },
        {
          id: second.activeTabId,
          type: "terminal",
          title: "z-code 2",
        },
      ],
    });
    expect(first.activeTabId).toMatch(/^terminal:/);
    expect(second.activeTabId).toMatch(/^terminal:/);
    expect(second.activeTabId).not.toBe(first.activeTabId);
  });

  it("updates metadata for the targeted browser tab", () => {
    const current = openBrowserSidePane(openBrowserSidePane(null, { tabId: "browser:a" }), {
      tabId: "browser:b",
    });

    expect(
      withoutOpenedAt(
        updateBrowserSidePaneTab(current, "browser:b", {
          faviconUrl: "https://example.com/favicon.ico",
          title: "Example",
        }),
      ),
    ).toEqual({
      activeTabId: "browser:b",
      tabs: [
        {
          id: "browser:a",
          type: "browser",
          faviconUrl: null,
          initialUrl: null,
          title: null,
        },
        {
          id: "browser:b",
          type: "browser",
          faviconUrl: "https://example.com/favicon.ico",
          initialUrl: null,
          title: "Example",
        },
      ],
    });
  });

  it("activates an existing browser tab when toggled from another tab", () => {
    const current = openCodeViewerSidePane(
      openBrowserSidePane(null, { tabId: "browser:a" }),
      viewerSource,
    );

    expect(withoutOpenedAt(toggleBrowserSidePane(current))).toEqual({
      activeTabId: "browser:a",
      tabs: [
        {
          id: "browser:a",
          type: "browser",
          faviconUrl: null,
          initialUrl: null,
          title: null,
        },
        {
          id: "code-viewer:file:/workspace/demo.ts",
          type: "code-viewer",
          source: viewerSource,
          sourceKey: "file:/workspace/demo.ts",
        },
      ],
    });
  });

  it("reuses the same code viewer tab for the same file path", () => {
    const first = openCodeViewerSidePane(null, viewerSource);
    const second = openCodeViewerSidePane(first, {
      ...viewerSource,
      offset: 128,
    });

    expect(second.tabs).toHaveLength(1);
    expect(getActiveSidePaneTab(second)).toMatchObject({
      id: "code-viewer:file:/workspace/demo.ts",
      type: "code-viewer",
      source: {
        ...viewerSource,
        offset: 128,
      },
    });
  });

  it("批量打开多份 PPTX，并激活卡片顺序Medium的第One份", () => {
    const current = activateBrowserSidePane(null, { tabId: "browser:kept" });
    const sources = [
      {
        type: "file" as const,
        title: "first.pptx",
        path: "/workspace/first.pptx",
        workspacePath: "/workspace",
      },
      {
        type: "file" as const,
        title: "second.pptx",
        path: "/workspace/second.pptx",
        workspacePath: "/workspace",
      },
    ];

    const next = openCodeViewerSidePanes(current, sources, "session-a");

    expect(next.tabs).toHaveLength(3);
    expect(next.tabs[0]).toMatchObject({ id: "browser:kept", type: "browser" });
    expect(next.tabs.slice(1)).toMatchObject([
      {
        type: "code-viewer",
        source: sources[0],
        sourceKey: "/workspace:pptx:/workspace/first.pptx",
      },
      {
        type: "code-viewer",
        source: sources[1],
        sourceKey: "/workspace:pptx:/workspace/second.pptx",
      },
    ]);
    expect(next.activeTabId).toBe("code-viewer:/workspace:pptx:/workspace/first.pptx");
  });

  it("批量打开会按 workspace sourceKey 去重并复用现有 Tab", () => {
    const source = {
      type: "file" as const,
      title: "deck.pptx",
      path: "/workspace/deck.pptx",
      workspacePath: "/workspace",
      workspaceIdentity: "remote:ssh:host-a:/workspace",
    };
    const first = stampSidePaneTabsOwnership(openCodeViewerSidePane(null, source), {
      ownerTaskId: "session-a",
      workspaceKey: "remote:ssh:host-a:/workspace",
      remoteSessionId: null,
    });
    const next = openCodeViewerSidePanes(
      first,
      [source, { ...source, title: "deck updated.pptx" }],
      "session-a",
    );

    expect(next.tabs).toHaveLength(1);
    expect(getActiveSidePaneTab(next)).toMatchObject({
      type: "code-viewer",
      ownerTaskId: "session-a",
      source: source,
      sourceKey: "remote:ssh:host-a:/workspace:pptx:/workspace/deck.pptx",
    });
  });

  it("reuses the same code-review tab for one file while refreshing the model review", () => {
    const source = {
      type: "code-review" as const,
      title: "demo.ts",
      path: "/workspace/demo.ts",
      workspacePath: "/workspace",
      workspaceIdentity: "remote:ssh:host-a:/workspace",
      review: {
        requestId: "review-1",
        title: "First review",
        body: "First body",
        startLine: 2,
        endLine: 3,
      },
    };
    const first = openCodeViewerSidePane(null, source);
    const second = openCodeViewerSidePane(first, {
      ...source,
      review: {
        ...source.review,
        requestId: "review-2",
        title: "Second review",
        body: "Second body",
        startLine: 8,
        endLine: 8,
      },
    });

    expect(second.tabs).toHaveLength(1);
    expect(getActiveSidePaneTab(second)).toMatchObject({
      id: "code-viewer:remote:ssh:host-a:/workspace:code-review:/workspace/demo.ts",
      sourceKey: "remote:ssh:host-a:/workspace:code-review:/workspace/demo.ts",
      source: {
        type: "code-review",
        review: {
          requestId: "review-2",
          title: "Second review",
          body: "Second body",
          startLine: 8,
          endLine: 8,
        },
      },
    });
  });

  it("keeps ordinary file and code-review tabs separate for the same path", () => {
    const reviewSource = {
      type: "code-review" as const,
      title: "demo.ts",
      path: "/workspace/demo.ts",
      review: {
        requestId: "review-1",
        title: "Review",
        body: "Body",
      },
    };
    const first = openCodeViewerSidePane(null, viewerSource);
    const second = openCodeViewerSidePane(first, reviewSource);

    expect(second.tabs).toHaveLength(2);
    expect(second.tabs.map((tab) => (tab.type === "code-viewer" ? tab.sourceKey : null))).toEqual([
      "file:/workspace/demo.ts",
      "code-review:/workspace/demo.ts",
    ]);
  });

  it("reuses the same code viewer tab for the same pdf path", () => {
    const pdfSource = {
      type: "pdf" as const,
      title: "report.pdf",
      path: "/workspace/report.pdf",
    };
    const first = openCodeViewerSidePane(null, pdfSource);
    const second = openCodeViewerSidePane(first, pdfSource);

    expect(second.tabs).toHaveLength(1);
    expect(getActiveSidePaneTab(second)).toMatchObject({
      id: "code-viewer:pdf:/workspace/report.pdf",
      type: "code-viewer",
      source: pdfSource,
    });
  });

  it("reuses the same PPTX tab while refreshing reference navigation intent", () => {
    const source = {
      type: "pptx" as const,
      title: "deck.pptx",
      path: "/workspace/deck.pptx",
      referenceNavigation: {
        requestId: "navigation-1",
        pageIndex: 0,
        expectedSourceFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };
    const first = openCodeViewerSidePane(null, source);
    const second = openCodeViewerSidePane(first, {
      ...source,
      referenceNavigation: {
        ...source.referenceNavigation,
        requestId: "navigation-2",
        pageIndex: 2,
      },
    });

    expect(second.tabs).toHaveLength(1);
    expect(getActiveSidePaneTab(second)).toMatchObject({
      id: "code-viewer:pptx:/workspace/deck.pptx",
      source: {
        referenceNavigation: {
          requestId: "navigation-2",
          pageIndex: 2,
        },
      },
    });
  });

  it("reuses the file-tree PPTX tab when a presentation reference opens the same file", () => {
    const fileTreeSource = {
      type: "file" as const,
      title: "deck.pptx",
      path: "/workspace/deck.pptx",
      workspacePath: "/workspace",
    };
    const referenceSource = {
      type: "pptx" as const,
      title: "deck.pptx",
      path: "/workspace/deck.pptx",
      workspacePath: "/workspace",
      referenceNavigation: {
        requestId: "navigation-from-reference",
        pageIndex: 2,
        expectedSourceFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };

    const first = openCodeViewerSidePane(null, fileTreeSource);
    const second = openCodeViewerSidePane(first, referenceSource);

    expect(second.tabs).toHaveLength(1);
    expect(getActiveSidePaneTab(second)).toMatchObject({
      id: "code-viewer:/workspace:pptx:/workspace/deck.pptx",
      sourceKey: "/workspace:pptx:/workspace/deck.pptx",
      source: referenceSource,
    });
  });

  it("reuses the reference-opened PPTX tab when the file tree opens the same file", () => {
    const referenceSource = {
      type: "pptx" as const,
      title: "deck.pptx",
      path: "/workspace/deck.pptx",
      workspacePath: "/workspace",
      referenceNavigation: {
        requestId: "navigation-from-reference",
        pageIndex: 2,
        expectedSourceFingerprint: `sha256:${"a".repeat(64)}`,
      },
    };
    const fileTreeSource = {
      type: "file" as const,
      title: "deck.pptx",
      path: "/workspace/deck.pptx",
      workspacePath: "/workspace",
    };

    const first = openCodeViewerSidePane(null, referenceSource);
    const second = openCodeViewerSidePane(first, fileTreeSource);

    expect(second.tabs).toHaveLength(1);
    expect(getActiveSidePaneTab(second)).toMatchObject({
      id: "code-viewer:/workspace:pptx:/workspace/deck.pptx",
      sourceKey: "/workspace:pptx:/workspace/deck.pptx",
      source: fileTreeSource,
    });
  });

  it("keeps same-path file previews isolated by workspace identity", () => {
    const first = openCodeViewerSidePane(null, {
      ...viewerSource,
      workspaceIdentity: "remote:ssh:host-a:/workspace",
    });
    const second = openCodeViewerSidePane(first, {
      ...viewerSource,
      workspaceIdentity: "remote:ssh:host-b:/workspace",
    });

    expect(second.tabs).toHaveLength(2);
    expect(second.tabs.map((tab) => (tab.type === "code-viewer" ? tab.sourceKey : null))).toEqual([
      "remote:ssh:host-a:/workspace:file:/workspace/demo.ts",
      "remote:ssh:host-b:/workspace:file:/workspace/demo.ts",
    ]);
  });

  it("normalizes uri-encoded code viewer paths before creating tab keys", () => {
    const encodedSource = {
      type: "file" as const,
      title: "engine.ts",
      path: "/Users/dev/CfProject/323/Auto%20Snake/src/game/engine.ts",
    };
    const decodedPath = "/Users/dev/CfProject/323/Auto Snake/src/game/engine.ts";

    const first = openCodeViewerSidePane(null, encodedSource);
    const second = openCodeViewerSidePane(first, {
      ...encodedSource,
      path: decodedPath,
    });

    expect(second.tabs).toHaveLength(1);
    expect(getActiveSidePaneTab(second)).toMatchObject({
      id: `code-viewer:file:${decodedPath}`,
      type: "code-viewer",
      source: {
        ...encodedSource,
        path: decodedPath,
      },
      sourceKey: `file:${decodedPath}`,
    });
  });

  it("keeps different patch previews for the same file in separate tabs", () => {
    const firstPatch = {
      type: "patch" as const,
      title: "demo.ts",
      path: "/workspace/demo.ts",
      patch: "--- a/demo.ts\n+++ b/demo.ts\n@@\n-old\n+new",
    };
    const secondPatch = {
      ...firstPatch,
      patch: "--- a/demo.ts\n+++ b/demo.ts\n@@\n-old\n+newer",
    };

    const first = openCodeViewerSidePane(null, firstPatch);
    const second = openCodeViewerSidePane(first, secondPatch);
    const reopenedSecond = openCodeViewerSidePane(second, secondPatch);

    expect(second.tabs).toHaveLength(2);
    expect(second.tabs.map((tab) => (tab.type === "code-viewer" ? tab.source : null))).toEqual([
      firstPatch,
      secondPatch,
    ]);
    expect(reopenedSecond.tabs).toHaveLength(2);
    expect(reopenedSecond.activeTabId).toBe(second.activeTabId);
  });

  it("keeps different MultiFileDiff previews for the same file in separate tabs", () => {
    const firstDiff = {
      type: "multi-file-diff" as const,
      title: "demo.ts",
      path: "/workspace/demo.ts",
      beforeContent: "const value = 1;\n",
      afterContent: "const value = 2;\n",
    };
    const secondDiff = {
      ...firstDiff,
      afterContent: "const value = 3;\n",
    };

    const first = openCodeViewerSidePane(null, firstDiff);
    const second = openCodeViewerSidePane(first, secondDiff);
    const reopenedSecond = openCodeViewerSidePane(second, secondDiff);

    expect(second.tabs).toHaveLength(2);
    expect(second.tabs.map((tab) => (tab.type === "code-viewer" ? tab.source : null))).toEqual([
      firstDiff,
      secondDiff,
    ]);
    expect(reopenedSecond.tabs).toHaveLength(2);
    expect(reopenedSecond.activeTabId).toBe(second.activeTabId);
  });

  it("activates git without dropping existing tabs", () => {
    const current = activateBrowserSidePane(openCodeViewerSidePane(null, viewerSource), {
      tabId: "browser:a",
    });

    expect(withoutOpenedAt(toggleGitSidePane(current))).toEqual({
      activeTabId: "git",
      tabs: [
        {
          id: "code-viewer:file:/workspace/demo.ts",
          type: "code-viewer",
          source: viewerSource,
          sourceKey: "file:/workspace/demo.ts",
        },
        {
          id: "browser:a",
          type: "browser",
          faviconUrl: null,
          initialUrl: null,
          title: null,
        },
        { id: "git", type: "git" },
      ],
    });
  });

  it("reorders tabs without changing active tab", () => {
    const current = activateBrowserSidePane(openCodeViewerSidePane(null, viewerSource), {
      tabId: "browser:a",
    });
    const withGit = toggleGitSidePane(current)!;

    expect(
      withoutOpenedAt(reorderSidePaneTab(withGit, "git", "code-viewer:file:/workspace/demo.ts")),
    ).toEqual({
      activeTabId: "git",
      tabs: [
        { id: "git", type: "git" },
        {
          id: "code-viewer:file:/workspace/demo.ts",
          type: "code-viewer",
          source: viewerSource,
          sourceKey: "file:/workspace/demo.ts",
        },
        {
          id: "browser:a",
          type: "browser",
          faviconUrl: null,
          initialUrl: null,
          title: null,
        },
      ],
    });
  });

  it("keeps state unchanged when reordering unknown tabs", () => {
    const current = activateBrowserSidePane(openCodeViewerSidePane(null, viewerSource), {
      tabId: "browser:a",
    });

    expect(reorderSidePaneTab(current, "missing", "browser:a")).toBe(current);
    expect(reorderSidePaneTab(current, "browser:a", "missing")).toBe(current);
  });

  it("closes the active tab and falls back to the neighbor on the right", () => {
    const state = {
      activeTabId: "browser:a",
      tabs: [
        {
          id: "code-viewer:file:/workspace/demo.ts",
          type: "code-viewer" as const,
          source: viewerSource,
          sourceKey: "file:/workspace/demo.ts",
        },
        { id: "browser:a", type: "browser" as const },
        { id: "git", type: "git" as const },
      ],
    };

    expect(withoutOpenedAt(closeSidePaneTab(state, "browser:a"))).toEqual({
      activeTabId: "git",
      tabs: [
        {
          id: "code-viewer:file:/workspace/demo.ts",
          type: "code-viewer",
          source: viewerSource,
          sourceKey: "file:/workspace/demo.ts",
        },
        { id: "git", type: "git" },
      ],
    });
  });

  it("closes other tabs and activates the retained tab", () => {
    const state = {
      activeTabId: "browser:a",
      tabs: [
        {
          id: "code-viewer:file:/workspace/demo.ts",
          type: "code-viewer" as const,
          source: viewerSource,
          sourceKey: "file:/workspace/demo.ts",
        },
        { id: "browser:a", type: "browser" as const },
        { id: "git", type: "git" as const },
      ],
    };

    expect(withoutOpenedAt(closeOtherSidePaneTabs(state, "git"))).toEqual({
      activeTabId: "git",
      tabs: [{ id: "git", type: "git" }],
    });
  });

  it("restores a closed tab as the active tab", () => {
    const state = restoreSidePaneTab(null, {
      id: "browser:a",
      type: "browser",
      initialUrl: "https://example.com",
      openedAt: 123,
    });

    expect(withoutOpenedAt(state)).toEqual({
      activeTabId: "browser:a",
      tabs: [
        {
          id: "browser:a",
          type: "browser",
          initialUrl: "https://example.com",
        },
      ],
    });
  });

  describe("openBrowserUseSidePane", () => {
    it("按 tabId 建 browser-use tab，并Write origin session/workspace 归属", () => {
      const state = openBrowserUseSidePane(null, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        tabId: "tab-1",
      });
      expect(state.activeTabId).toBe("browser-use:tab-1");
      expect(state.tabs).toHaveLength(1);
      const tab = state.tabs[0];
      expect(tab.type).toBe("browser-use");
      expect(tab).toMatchObject({
        id: "browser-use:tab-1",
        ownerTaskId: "sess-1",
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        tabId: "tab-1",
      });
    });

    it("同One tabId Replay ready 时复用同One tab（不重复开）", () => {
      const first = openBrowserUseSidePane(null, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        tabId: "tab-1",
      });
      const second = openBrowserUseSidePane(first, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        tabId: "tab-1",
      });
      expect(second.tabs).toHaveLength(1);
      expect(second.activeTabId).toBe("browser-use:tab-1");
    });

    it("不同 sessionId 各开One个 tab", () => {
      const first = openBrowserUseSidePane(null, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        tabId: "tab-1",
      });
      const second = openBrowserUseSidePane(first, {
        workspaceKey: "/workspace",
        sessionId: "sess-2",
        tabId: "tab-2",
      });
      expect(second.tabs).toHaveLength(2);
      expect(second.activeTabId).toBe("browser-use:tab-2");
    });

    it("显式 activate=false 可BackgroundAppend，后续 activate=true 再激活", () => {
      const current = openBrowserSidePane(null, { tabId: "browser:human" });
      const background = openBrowserUseSidePane(current, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        tabId: "tab-1",
        activate: false,
      });
      expect(background.activeTabId).toBe("browser:human");
      const visible = openBrowserUseSidePane(background, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        tabId: "tab-1",
        activate: true,
      });
      expect(visible.activeTabId).toBe("browser-use:tab-1");
    });

    it("updateBrowserSidePaneTab 回填 browser-use tab 的真实Title/favicon", () => {
      const opened = openBrowserUseSidePane(null, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        tabId: "tab-1",
      });
      const updated = updateBrowserSidePaneTab(opened, "browser-use:tab-1", {
        title: "Example Domain",
        faviconUrl: "https://example.com/favicon.ico",
      });
      const tab = updated?.tabs[0];
      expect(tab).toMatchObject({
        type: "browser-use",
        title: "Example Domain",
        faviconUrl: "https://example.com/favicon.ico",
      });
    });

    it("重开同One browser-use tab Retain已回填的Title/favicon（握手期 guest 重建不Clear）", () => {
      const opened = openBrowserUseSidePane(null, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        tabId: "tab-1",
      });
      const withMeta = updateBrowserSidePaneTab(opened, "browser-use:tab-1", {
        title: "Example Domain",
        faviconUrl: "https://example.com/favicon.ico",
      });
      const reopened = openBrowserUseSidePane(withMeta, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        tabId: "tab-1",
      });
      expect(reopened.tabs).toHaveLength(1);
      expect(reopened.tabs[0]).toMatchObject({
        type: "browser-use",
        title: "Example Domain",
        faviconUrl: "https://example.com/favicon.ico",
      });
    });

    it("按 workspace/session/tab Label记 5 秒操作Status且不覆盖 favicon", () => {
      const opened = openBrowserUseSidePane(null, {
        workspaceKey: "remote:ssh:host:/workspace",
        sessionId: "sess-1",
        tabId: "tab-1",
        browserId: "iab-1",
        browserGeneration: 7,
      });
      const withMeta = updateBrowserSidePaneTab(opened, "browser-use:tab-1", {
        faviconUrl: "https://example.com/favicon.ico",
      });
      const operationUntil = 10_000 + BROWSER_USE_OPERATION_INDICATOR_DURATION_MS;
      const marked = markBrowserUseSidePaneTabOperation(withMeta, {
        workspaceKey: "remote:ssh:host:/workspace",
        sessionId: "sess-1",
        browserId: "iab-1",
        browserGeneration: 7,
        tabId: "tab-1",
        operationUntil,
      });

      expect(marked?.tabs[0]).toMatchObject({
        faviconUrl: "https://example.com/favicon.ico",
        browserUseOperationUntil: operationUntil,
      });
      expect(
        markBrowserUseSidePaneTabOperation(marked, {
          workspaceKey: "/workspace",
          sessionId: "sess-1",
          browserId: "iab-1",
          browserGeneration: 7,
          tabId: "tab-1",
          operationUntil: operationUntil + 1,
        }),
      ).toBe(marked);
      expect(
        markBrowserUseSidePaneTabOperation(marked, {
          workspaceKey: "remote:ssh:host:/workspace",
          sessionId: "sess-1",
          browserId: "iab-1",
          browserGeneration: 8,
          tabId: "tab-1",
          operationUntil: operationUntil + 1,
        }),
      ).toBe(marked);
    });

    it("同One tab 的后续操作Refresh截止时间，只有布局Command推进 resize baseline Version", () => {
      const opened = openBrowserUseSidePane(null, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        browserId: "iab-1",
        browserGeneration: 1,
        tabId: "tab-1",
      });
      const first = markBrowserUseSidePaneTabOperation(opened, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        browserId: "iab-1",
        browserGeneration: 1,
        tabId: "tab-1",
        operationUntil: 5_000,
        resetsResizeBaseline: true,
      });
      const second = markBrowserUseSidePaneTabOperation(first, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        browserId: "iab-1",
        browserGeneration: 1,
        tabId: "tab-1",
        operationUntil: 9_000,
      });
      const third = markBrowserUseSidePaneTabOperation(second, {
        workspaceKey: "/workspace",
        sessionId: "sess-1",
        browserId: "iab-1",
        browserGeneration: 1,
        tabId: "tab-1",
        operationUntil: 12_000,
        resetsResizeBaseline: true,
      });

      expect(second?.tabs[0]).toMatchObject({
        browserUseOperationUntil: 9_000,
        browserUseResizeBaselineVersion: 1,
      });
      expect(third?.tabs[0]).toMatchObject({
        browserUseOperationUntil: 12_000,
        browserUseResizeBaselineVersion: 2,
      });
    });

    it("A 的迟到 ready 在 B active 时Background归属 A，切回 A 后可恢复", () => {
      const current = openBrowserSidePane(null, { tabId: "browser:b" });
      const stampedCurrent = stampSidePaneTabsOwnership(current, {
        workspaceKey: "/workspace",
        ownerTaskId: "sess-b",
      });
      const result = applyBrowserUseSidePaneEvent(
        stampedCurrent,
        {
          workspaceKey: "/workspace",
          sessionId: "sess-a",
          tabId: "tab-a",
          browserId: "iab",
          browserGeneration: 1,
        },
        { workspaceKey: "/workspace", ownerTaskId: "sess-b" },
      );

      expect(result.shouldReveal).toBe(false);
      expect(result.state.activeTabId).toBe("browser:b");
      expect(result.state.tabs.at(-1)).toMatchObject({
        id: "browser-use:tab-a",
        ownerTaskId: "sess-a",
        workspaceKey: "/workspace",
        sessionId: "sess-a",
      });
      expect(
        resolveActiveTabForOwner(result.state, {
          workspaceKey: "/workspace",
          ownerTaskId: "sess-a",
        }),
      ).toBe("browser-use:tab-a");
    });

    it("A 的 browser-use tab 在切到无 tab 的 B 后保持挂载，切回 A 主动展开", () => {
      const stateA = openBrowserUseSidePane(null, {
        workspaceKey: "/workspace",
        sessionId: "sess-a",
        tabId: "tab-a",
      });

      const stateB = resolveSidePaneScopeState(stateA, {
        workspaceKey: "/workspace",
        ownerTaskId: "sess-b",
      });
      expect(stateB.sidePaneState).toMatchObject({
        activeTabId: "",
        tabs: [{ id: "browser-use:tab-a", tabId: "tab-a" }],
      });
      expect(stateB.isSidePaneCollapsed).toBe(true);
      expect(shouldMountSidePaneContent(false, stateB.sidePaneState?.tabs ?? [])).toBe(true);

      const restoredA = resolveSidePaneScopeState(stateB.sidePaneState, {
        workspaceKey: "/workspace",
        ownerTaskId: "sess-a",
      });
      expect(restoredA.sidePaneState).toMatchObject({
        activeTabId: "browser-use:tab-a",
        tabs: [{ id: "browser-use:tab-a", tabId: "tab-a" }],
      });
      expect(restoredA.isSidePaneCollapsed).toBe(false);
    });

    it("A 主动Collapse后切到 B 再切回 A 仍保持Collapse", () => {
      const stateA = openBrowserUseSidePane(null, {
        workspaceKey: "/workspace",
        sessionId: "sess-a",
        tabId: "tab-a",
      });

      const stateB = resolveSidePaneScopeState(
        stateA,
        { workspaceKey: "/workspace", ownerTaskId: "sess-b" },
        undefined,
        true,
      );
      const restoredA = resolveSidePaneScopeState(
        stateB.sidePaneState,
        { workspaceKey: "/workspace", ownerTaskId: "sess-a" },
        undefined,
        true,
      );

      expect(restoredA.sidePaneState).toMatchObject({
        activeTabId: "browser-use:tab-a",
        tabs: [{ id: "browser-use:tab-a", tabId: "tab-a" }],
      });
      expect(restoredA.isSidePaneCollapsed).toBe(true);
    });

    it("origin session 仍 active 时立即展开并激活", () => {
      const result = applyBrowserUseSidePaneEvent(
        null,
        { workspaceKey: "/workspace", sessionId: "sess-a", tabId: "tab-a" },
        { workspaceKey: "/workspace", ownerTaskId: "sess-a" },
      );

      expect(result.shouldReveal).toBe(true);
      expect(result.state.activeTabId).toBe("browser-use:tab-a");
    });

    it("BTL19: remote visibility Replay不会Clear既有 remoteSessionId", () => {
      const ready = openBrowserUseSidePane(null, {
        workspaceKey: "ssh://host/repo",
        remoteSessionId: "remote-a",
        sessionId: "sess-a",
        tabId: "tab-a",
        browserId: "iab-a",
        browserGeneration: 2,
      });

      const result = applyBrowserUseSidePaneEvent(
        ready,
        {
          workspaceKey: "ssh://host/repo",
          remoteSessionId: "remote-a",
          sessionId: "sess-a",
          tabId: "tab-a",
          browserId: "iab-a",
          browserGeneration: 2,
        },
        {
          workspaceKey: "ssh://host/repo",
          remoteSessionId: "remote-a",
          ownerTaskId: "sess-a",
        },
      );
      const legacyReplay = applyBrowserUseSidePaneEvent(
        result.state,
        {
          workspaceKey: "ssh://host/repo",
          sessionId: "sess-a",
          tabId: "tab-a",
          browserId: "iab-a",
          browserGeneration: 2,
        },
        {
          workspaceKey: "ssh://host/repo",
          remoteSessionId: "remote-a",
          ownerTaskId: "sess-a",
        },
      );

      expect(result.state.tabs[0]).toMatchObject({ remoteSessionId: "remote-a" });
      expect(legacyReplay.state.tabs[0]).toMatchObject({ remoteSessionId: "remote-a" });
    });

    it("同One session 多个 browser-use tab 时 show Events激活Point to定 tab", () => {
      const first = openBrowserUseSidePane(null, {
        workspaceKey: "/workspace",
        sessionId: "sess-a",
        tabId: "tab-a",
      });
      const withBackground = openBrowserUseSidePane(first, {
        workspaceKey: "/workspace",
        sessionId: "sess-a",
        tabId: "tab-b",
        activate: false,
      });

      const result = applyBrowserUseSidePaneEvent(
        withBackground,
        { workspaceKey: "/workspace", sessionId: "sess-a", tabId: "tab-b" },
        { workspaceKey: "/workspace", ownerTaskId: "sess-a" },
      );

      expect(result.shouldReveal).toBe(true);
      expect(result.state.activeTabId).toBe("browser-use:tab-b");
    });

    it("visibility 只激活已有 browser-use tab，不创建已Close的 tab shell", () => {
      const first = openBrowserUseSidePane(null, {
        workspaceKey: "/workspace",
        sessionId: "sess-a",
        tabId: "tab-a",
      });
      const withBackground = openBrowserUseSidePane(first, {
        workspaceKey: "/workspace",
        sessionId: "sess-a",
        tabId: "tab-b",
        activate: false,
      });
      const activeScope = { workspaceKey: "/workspace", ownerTaskId: "sess-a" };

      const activated = applyBrowserUseSidePaneVisibilityEvent(
        withBackground,
        { workspaceKey: "/workspace", sessionId: "sess-a", tabId: "tab-b" },
        activeScope,
      );
      expect(activated.shouldReveal).toBe(true);
      expect(activated.state.activeTabId).toBe("browser-use:tab-b");

      const closed = closeSidePaneTab(activated.state, "browser-use:tab-b");
      const delayedVisibility = applyBrowserUseSidePaneVisibilityEvent(
        closed,
        { workspaceKey: "/workspace", sessionId: "sess-a", tabId: "tab-b" },
        activeScope,
      );
      expect(delayedVisibility.shouldReveal).toBe(false);
      expect(delayedVisibility.state).toBe(closed);
      expect(delayedVisibility.state.tabs).toHaveLength(1);
      expect(delayedVisibility.state.tabs[0]?.tabId).toBe("tab-a");
    });

    it("Background session 激活 tab 时不抢前台，切回可按 preferred tab 恢复", () => {
      const backgroundA = openBrowserUseSidePane(null, {
        workspaceKey: "/workspace",
        sessionId: "sess-x",
        tabId: "tab-x-a",
      });
      const backgroundB = openBrowserUseSidePane(backgroundA, {
        workspaceKey: "/workspace",
        sessionId: "sess-x",
        tabId: "tab-x-b",
        activate: false,
      });
      const foreground = openBrowserUseSidePane(backgroundB, {
        workspaceKey: "/workspace",
        sessionId: "sess-y",
        tabId: "tab-y",
      });

      const result = applyBrowserUseSidePaneEvent(
        foreground,
        { workspaceKey: "/workspace", sessionId: "sess-x", tabId: "tab-x-b" },
        { workspaceKey: "/workspace", ownerTaskId: "sess-y" },
      );

      expect(result.shouldReveal).toBe(false);
      expect(result.state.activeTabId).toBe("browser-use:tab-y");
      expect(
        resolveActiveTabForOwner(
          result.state,
          { workspaceKey: "/workspace", ownerTaskId: "sess-x" },
          "browser-use:tab-x-b",
        ),
      ).toBe("browser-use:tab-x-b");
    });

    it("Other workspace 的 ready 也只Background挂载，不抢CurrentChat", () => {
      const current = openBrowserSidePane(null, { tabId: "browser:b" });
      const stampedCurrent = stampSidePaneTabsOwnership(current, {
        workspaceKey: "/workspace-b",
        ownerTaskId: "sess-a",
      });
      const result = applyBrowserUseSidePaneEvent(
        stampedCurrent,
        { workspaceKey: "/workspace-a", sessionId: "sess-a", tabId: "tab-a" },
        { workspaceKey: "/workspace-b", ownerTaskId: "sess-a" },
      );

      expect(result.shouldReveal).toBe(false);
      expect(result.state.activeTabId).toBe("browser:b");
      expect(result.state.tabs.at(-1)).toMatchObject({
        workspaceKey: "/workspace-a",
      });
    });
  });

  describe("所有Tags类型的归属契About", () => {
    const base = {
      id: "tab",
      workspaceKey: "ssh://one/repo",
      workspacePath: "/repo",
      ownerTaskId: "owner",
      parentSessionId: "parent",
      rootSessionId: "root",
      sessionId: "session",
      childSessionId: "child",
      title: "Title",
      runId: "run",
      toolCallId: "call",
      ordinal: 1,
    };
    const cases = {
      browser: { tab: { ...base, type: "browser" }, owner: "owner" },
      "browser-permissions": {
        tab: { ...base, type: "browser-permissions", origin: "https://a.test" },
        owner: "owner",
      },
      "code-viewer": {
        tab: { ...base, type: "code-viewer", source: viewerSource, sourceKey: "file" },
        owner: "owner",
      },
      whiteboard: { tab: { ...base, type: "whiteboard", boardId: "board" }, owner: "owner" },
      "model-trajectory": {
        tab: { ...base, type: "model-trajectory", taskId: "target" },
        owner: "owner",
      },
      terminal: { tab: { ...base, type: "terminal" }, owner: "owner" },
      "browser-use": { tab: { ...base, type: "browser-use", tabId: "logical" }, owner: "session" },
      "bash-output": { tab: { ...base, type: "bash-output", workId: "work" }, owner: "root" },
      "subagent-session": {
        tab: { ...base, type: "subagent-session", subagentType: "Explore" },
        owner: "root",
      },
      "subagent-directory": { tab: { ...base, type: "subagent-directory" }, owner: "root" },
      "selection-side-chat": { tab: { ...base, type: "selection-side-chat" }, owner: "parent" },
      "plan-detail": { tab: { ...base, type: "plan-detail", markdown: "plan" }, owner: "parent" },
      "plugin-ui": {
        tab: { ...base, type: "plugin-ui", pluginId: "example", resourceUri: "ui://example/app" },
        owner: "parent",
      },
      "workflow-run": { tab: { ...base, type: "workflow-run" }, owner: "parent" },
      "workflow-directory": { tab: { ...base, type: "workflow-directory" }, owner: "parent" },
      "workflow-actor-session": {
        tab: { ...base, type: "workflow-actor-session", siteId: "actor" },
        owner: "parent",
      },
      "workflow-workspace": { tab: { ...base, type: "workflow-workspace" }, owner: "parent" },
      "workflow-artifact": {
        tab: { ...base, type: "workflow-artifact", artifactId: "artifact" },
        owner: "parent",
      },
      git: { tab: { ...base, id: "git", type: "git" }, owner: null },
      "developer-tools": {
        tab: { ...base, id: "developer-tools", type: "developer-tools" },
        owner: null,
      },
      "plugin-market": {
        tab: { ...base, id: "plugin-market", type: "plugin-market" },
        owner: null,
      },
      treemapping: { tab: { ...base, id: "treemapping", type: "treemapping" }, owner: null },
    } satisfies Record<
      WorkspaceSidePaneTab["type"],
      { tab: WorkspaceSidePaneTab; owner: string | null }
    >;
    for (const [type, { tab, owner }] of Object.entries(cases)) {
      it(`${type} 的Show与Close后选择使用E同Workspaceand owner`, () => {
        const scope = { workspaceKey: base.workspaceKey, ownerTaskId: owner ?? "any" };
        expect(isSidePaneTabVisibleInScope(tab, scope)).toBe(true);
        expect(isSidePaneTabVisibleInScope(tab, { ...scope, workspaceKey: "ssh://two/repo" })).toBe(
          false,
        );
        expect(isSidePaneTabVisibleInScope(tab, { ...scope, ownerTaskId: "other" })).toBe(
          owner === null,
        );
        expect(
          selectSidePaneTabsForScope({ tabs: [tab], activeTabId: "missing" }, scope)?.activeTabId,
        ).toBe(tab.id);
      });
    }
  });

  describe("按 (Project, Chat) Isolated", () => {
    const scope = (ownerTaskId: string | null, workspaceKey: string | null = null) => ({
      workspaceKey,
      ownerTaskId,
    });

    it("stampSidePaneTabsOwnership 只To未打Label(undefined)的New tab 打归属(Chat+Project)，已打Label的不动", () => {
      const opened = openBrowserSidePane(null, { tabId: "browser:1" });
      expect(opened.tabs[0]!.ownerTaskId).toBeUndefined();
      const stamped = stampSidePaneTabsOwnership(opened, {
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      })!;
      expect(stamped.tabs[0]!.ownerTaskId).toBe("task-a");
      expect(stamped.tabs[0]!.workspaceKey).toBe("ws-1");
      const restamped = stampSidePaneTabsOwnership(stamped, {
        ownerTaskId: "task-b",
        workspaceKey: "ws-2",
      })!;
      expect(restamped.tabs[0]!.ownerTaskId).toBe("task-a");
      expect(restamped).toBe(stamped);
    });

    it("getVisibleSidePaneTabs 按Chat过滤；undefined/null 归到Draft；workspace Tools对本Project所有Chat可见", () => {
      const tabs = [
        { id: "a", type: "browser" as const, ownerTaskId: "task-a" },
        { id: "b", type: "browser" as const, ownerTaskId: "task-b" },
        { id: "d", type: "browser" as const, ownerTaskId: null },
        { id: "u", type: "browser" as const },
        { id: "git", type: "git" as const, ownerTaskId: "task-a" },
      ];
      expect(getVisibleSidePaneTabs(tabs, scope("task-a")).map((t) => t.id)).toEqual(["a", "git"]);
      expect(getVisibleSidePaneTabs(tabs, scope("task-b")).map((t) => t.id)).toEqual(["b", "git"]);
      expect(getVisibleSidePaneTabs(tabs, scope(null)).map((t) => t.id)).toEqual(["d", "u", "git"]);
    });

    it("getVisibleSidePaneTabs By Project(workspaceKey)Isolated：切Project只看本Project的 tab（含 workspace Tools）", () => {
      const tabs = [
        {
          id: "a1",
          type: "browser" as const,
          ownerTaskId: "task-a",
          workspaceKey: "ws-1",
        },
        {
          id: "b1",
          type: "browser" as const,
          ownerTaskId: "task-b",
          workspaceKey: "ws-2",
        },
        {
          id: "git1",
          type: "git" as const,
          ownerTaskId: "task-a",
          workspaceKey: "ws-1",
        },
        {
          id: "git2",
          type: "git" as const,
          ownerTaskId: "task-b",
          workspaceKey: "ws-2",
        },
      ];
      expect(getVisibleSidePaneTabs(tabs, scope("task-a", "ws-1")).map((t) => t.id)).toEqual([
        "a1",
        "git1",
      ]);
      expect(getVisibleSidePaneTabs(tabs, scope("task-b", "ws-2")).map((t) => t.id)).toEqual([
        "b1",
        "git2",
      ]);
    });

    it("resolveActiveTabForOwner：preferred 优先 → Current active → 该Scope最New → 无则 null", () => {
      const state = {
        activeTabId: "a2",
        tabs: [
          { id: "a1", type: "browser" as const, ownerTaskId: "task-a" },
          { id: "a2", type: "browser" as const, ownerTaskId: "task-a" },
          { id: "b1", type: "browser" as const, ownerTaskId: "task-b" },
        ],
      };
      expect(resolveActiveTabForOwner(state, scope("task-a"), "a1")).toBe("a1");
      expect(resolveActiveTabForOwner(state, scope("task-a"), "b1")).toBe("a2");
      expect(resolveActiveTabForOwner(state, scope("task-b"))).toBe("b1");
      expect(resolveActiveTabForOwner(state, scope("task-c"))).toBeNull();
    });

    it("toggle/activate browser 只复用CurrentChat的 browser tab，不串用别的Chat", () => {
      const stateA = stampSidePaneTabsOwnership(openBrowserSidePane(null, { tabId: "browser:a" }), {
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      })!;
      expect(getVisibleSidePaneTabs(stateA.tabs, scope("task-a", "ws-1")).map((t) => t.id)).toEqual(
        ["browser:a"],
      );

      const toggled = stampSidePaneTabsOwnership(toggleBrowserSidePane(stateA, "task-b"), {
        ownerTaskId: "task-b",
        workspaceKey: "ws-1",
      })!;
      expect(toggled.tabs).toHaveLength(2);
      const bVisible = getVisibleSidePaneTabs(toggled.tabs, scope("task-b", "ws-1"));
      expect(bVisible).toHaveLength(1);
      expect(bVisible[0]!.id).not.toBe("browser:a");
      expect(toggled.activeTabId).toBe(bVisible[0]!.id);
      expect(
        getVisibleSidePaneTabs(toggled.tabs, scope("task-a", "ws-1")).map((t) => t.id),
      ).toEqual(["browser:a"]);
    });
  });

  describe("openOrActivateBrowserSidePaneByUrl", () => {
    const REPORT_URL = "file:///repo/report.html";

    it("同One workspace/owner 的同One URL 只激活已有 tab，并Retain它的Character段", () => {
      const first = openOrActivateBrowserSidePaneByUrl(null, {
        initialUrl: REPORT_URL,
        tabId: "browser:first",
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      });
      const other = openBrowserSidePane(first, { tabId: "browser:other" });
      const second = openOrActivateBrowserSidePaneByUrl(other, {
        initialUrl: REPORT_URL,
        tabId: "browser:second",
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      });

      expect(second.tabs.filter((tab) => tab.id === "browser:first")).toHaveLength(1);
      expect(second.tabs.some((tab) => tab.id === "browser:second")).toBe(false);
      expect(second.activeTabId).toBe("browser:first");
      expect(second.tabs.find((tab) => tab.id === "browser:first")).toEqual(
        first.tabs.find((tab) => tab.id === "browser:first"),
      );
    });

    it("URL / owner / workspace 任One不同都另开One个 tab", () => {
      const base = openOrActivateBrowserSidePaneByUrl(null, {
        initialUrl: REPORT_URL,
        tabId: "browser:base",
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      });

      const otherUrl = openOrActivateBrowserSidePaneByUrl(base, {
        initialUrl: "file:///repo/other.html",
        tabId: "browser:url",
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      });
      expect(otherUrl.activeTabId).toBe("browser:url");

      const otherOwner = openOrActivateBrowserSidePaneByUrl(base, {
        initialUrl: REPORT_URL,
        tabId: "browser:owner",
        ownerTaskId: "task-b",
        workspaceKey: "ws-1",
      });
      expect(otherOwner.activeTabId).toBe("browser:owner");

      const otherWorkspace = openOrActivateBrowserSidePaneByUrl(base, {
        initialUrl: REPORT_URL,
        tabId: "browser:workspace",
        ownerTaskId: "task-a",
        workspaceKey: "ws-2",
      });
      expect(otherWorkspace.activeTabId).toBe("browser:workspace");
    });

    it("tabId 缺席时现生成（share handover 的老调用形状不变）", () => {
      const state = openOrActivateBrowserSidePaneByUrl(null, {
        initialUrl: "https://example.com/share/abc",
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      });
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0]!.id.startsWith("browser:")).toBe(true);
      expect(state.tabs[0]).toMatchObject({
        type: "browser",
        initialUrl: "https://example.com/share/abc",
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      });
    });

    it("findBrowserSidePaneTabByUrl 与 open 落到同One个 tab（调用方据它发导航Request）", () => {
      const opened = stampSidePaneTabsOwnership(
        openOrActivateBrowserSidePaneByUrl(null, {
          initialUrl: REPORT_URL,
          tabId: "browser:stamped",
          workspaceKey: "ws-1",
        }),
        { ownerTaskId: "task-a", workspaceKey: "ws-1" },
      )!;

      const found = findBrowserSidePaneTabByUrl(opened, {
        initialUrl: REPORT_URL,
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      });
      expect(found?.id).toBe("browser:stamped");

      const again = openOrActivateBrowserSidePaneByUrl(opened, {
        initialUrl: REPORT_URL,
        tabId: "browser:new",
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      });
      expect(again.tabs).toHaveLength(1);
      expect(again.activeTabId).toBe("browser:stamped");
    });

    it("没有匹配 URL 时Return undefined", () => {
      const state = openBrowserSidePane(null, { tabId: "browser:a" });
      expect(
        findBrowserSidePaneTabByUrl(state, { initialUrl: REPORT_URL, ownerTaskId: "task-a" }),
      ).toBeUndefined();
      expect(findBrowserSidePaneTabByUrl(null, { initialUrl: REPORT_URL })).toBeUndefined();
    });
  });

  describe("openBrowserPermissionsSidePane", () => {
    it("同站点 + 同Workspace + 同Chat复用既有Tags并激活，不New", () => {
      const opened = openBrowserPermissionsSidePane(null, {
        origin: "https://example.com",
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      });
      expect(opened.tabs).toHaveLength(1);
      const tab = opened.tabs[0]!;
      expect(tab.type).toBe("browser-permissions");
      const again = openBrowserPermissionsSidePane(
        { ...opened, activeTabId: "" },
        { origin: "https://example.com", ownerTaskId: "task-a", workspaceKey: "ws-1" },
      );
      expect(again.tabs).toHaveLength(1);
      expect(again.activeTabId).toBe(tab.id);
    });

    it("不同站点、不同Workspaceor不同Chat各自开NewTags", () => {
      const opened = openBrowserPermissionsSidePane(null, {
        origin: "https://example.com",
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      });
      const otherOrigin = openBrowserPermissionsSidePane(opened, {
        origin: "https://other.com",
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      });
      const otherWorkspace = openBrowserPermissionsSidePane(otherOrigin, {
        origin: "https://example.com",
        ownerTaskId: "task-a",
        workspaceKey: "ws-2",
      });
      const otherOwner = openBrowserPermissionsSidePane(otherWorkspace, {
        origin: "https://example.com",
        ownerTaskId: "task-b",
        workspaceKey: "ws-1",
      });
      expect(otherOwner.tabs).toHaveLength(4);
    });

    it("按 owner Scope过滤：归属 task-a 的SettingsTags对 task-b 不可见", () => {
      const opened = openBrowserPermissionsSidePane(null, {
        origin: "https://example.com",
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      });
      expect(
        resolveActiveTabForOwner(opened, { workspaceKey: "ws-1", ownerTaskId: "task-a" }),
      ).toBe(opened.tabs[0]!.id);
      expect(
        resolveActiveTabForOwner(opened, { workspaceKey: "ws-1", ownerTaskId: "task-b" }),
      ).toBeNull();
    });
  });
});

it("站点Settings独立Tags按 workspace/owner/origin 复用，不替换Web", () => {
  const browser = activateBrowserSidePane(null, {
    initialUrl: "https://site.test",
    ownerTaskId: "task-a",
    workspaceKey: "ssh:a",
  });
  const options = { origin: "https://site.test", ownerTaskId: "task-a", workspaceKey: "ssh:a" };
  const opened = openBrowserPermissionsSidePane(browser, options);
  expect(opened.tabs).toHaveLength(2);
  expect(opened.tabs[0]).toEqual(browser.tabs[0]);
  expect(openBrowserPermissionsSidePane(opened, options)).toEqual(opened);
  expect(
    openBrowserPermissionsSidePane(opened, { ...options, workspaceKey: "ssh:b" }).tabs,
  ).toHaveLength(3);
  expect(
    openBrowserPermissionsSidePane(opened, { ...options, ownerTaskId: "task-b" }).tabs,
  ).toHaveLength(3);
});
