// @vitest-environment jsdom
import { createElement, useEffect, useMemo, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TID_WORKFLOWS_CREATE_VIA_CHAT,
  TID_WORKFLOWS_EMPTY,
  TID_WORKFLOWS_OPEN_SETTINGS,
  TID_WORKFLOWS_REFRESH,
  applyDynamicWorkflowUserMode,
  createDynamicWorkflowClientConfig,
  TID_WORKFLOW_GLOBAL_GROUP,
  TID_WORKFLOW_PROJECT_GROUP,
  resolveWorkspaceKey,
} from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import {
  resetDynamicWorkflowAvailabilityStoreForTests,
  useDynamicWorkflowAvailabilityStore,
} from "@/store/dynamicWorkflowAvailabilityStore.js";
import type { AutomationWorkspaceOption } from "@/settings/automationWorkspaceOptions.js";
import type {
  SavedWorkflowGroupMode,
  SavedWorkflowGroupState,
} from "@/settings/saved-workflows/savedWorkflowContract.js";

interface FakeTab {
  id: string;
  kind: "workspace" | "settings";
  workspacePath: string;
  label: string;
  workspacePurpose?: string;
  availability?: string;
  remoteSessionId?: string;
}

const tabStoreState: {
  tabs: FakeTab[];
  activeWorkspacePath: string | null;
  activeWorkspaceIdentity: string | null;
  openSettingsTab: () => void;
} = {
  tabs: [],
  activeWorkspacePath: null,
  activeWorkspaceIdentity: null,
  openSettingsTab: () => {},
};
const settingsNavigation = vi.hoisted(() => ({ setPendingSettingsSectionIntent: vi.fn() }));
vi.mock("@/lib/settingsNavigation.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setPendingSettingsSectionIntent: settingsNavigation.setPendingSettingsSectionIntent,
}));

vi.mock("@/store/TabStoreProvider.js", () => ({
  useTabStore: (selector: (state: typeof tabStoreState) => unknown) => selector(tabStoreState),
}));
vi.mock("@/project-sidebar/useSavedWorkflowProjectOptions.js", () => ({
  useSavedWorkflowProjectOptions: () =>
    useMemo(
      () =>
        tabStoreState.tabs
          .filter(
            (tab) =>
              tab.kind === "workspace" &&
              tab.workspacePurpose !== "conversation" &&
              tab.availability !== "unavailable",
          )
          .map((tab) => ({
            projectId: tab.id,
            hostId: tab.remoteSessionId ? "remote:server:test" : "local",
            ...(tab.remoteSessionId
              ? { workspaceIdentity: `remote:server:test:${tab.workspacePath}` }
              : {}),
            workspacePath: tab.workspacePath,
            label: tab.label,
          })),
      [tabStoreState.tabs],
    ),
}));
vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children: ReactNode }) => children,
}));

const groupReadiness: Record<string, SavedWorkflowGroupState> = {};

vi.mock("@/settings/saved-workflows/SavedWorkflowProjectGroup.js", () => ({
  SavedWorkflowProjectGroup: ({
    project,
    isCurrent,
    refreshSeq,
    mode,
    onStateChange,
    onOpenDetail,
    onNavigateToLaunchedRun,
    onCreateViaChat,
    onBack,
  }: {
    project: AutomationWorkspaceOption;
    isCurrent: boolean;
    refreshSeq: number;
    mode: SavedWorkflowGroupMode;
    onStateChange: (workspaceKey: string, state: SavedWorkflowGroupState) => void;
    onOpenDetail: (name: string) => void;
    onNavigateToLaunchedRun?: (target: unknown, sessionId: string) => void;
    onCreateViaChat?: (prompt: string, target: unknown) => void;
    onBack: () => void;
  }) => {
    const key = resolveWorkspaceKey({
      workspacePath: project.workspacePath,
      ...(project.workspaceIdentity ? { workspaceIdentity: project.workspaceIdentity } : {}),
    });
    const st = groupReadiness[project.workspacePath] ?? { loaded: false, empty: false, count: 0 };
    useEffect(() => {
      onStateChange(key, st);
    }, [key, onStateChange, refreshSeq, st.count, st.empty, st.loaded]);
    if (mode.kind === "list" && st.loaded && st.empty) return null;
    return createElement(
      "div",
      {
        "data-testid": testId(TID_WORKFLOW_PROJECT_GROUP, key),
        "data-current": isCurrent ? "true" : "false",
        "data-mode": mode.kind,
        "data-refresh": String(refreshSeq),
        "data-name": mode.kind === "detail" ? mode.name : "",
      },
      project.label,
      createElement(
        "button",
        {
          type: "button",
          "data-testid": `open-${project.workspacePath}`,
          onClick: () => onOpenDetail("wf-1"),
        },
        "open",
      ),
      createElement(
        "button",
        {
          type: "button",
          "data-testid": `launch-${project.workspacePath}`,
          onClick: () => onNavigateToLaunchedRun?.({ workspacePath: project.workspacePath }, "s-1"),
        },
        "launch",
      ),
      createElement(
        "button",
        {
          type: "button",
          "data-testid": `create-${project.workspacePath}`,
          onClick: () => onCreateViaChat?.("create", { workspacePath: project.workspacePath }),
        },
        "create",
      ),
      createElement(
        "button",
        { type: "button", "data-testid": `back-${project.workspacePath}`, onClick: onBack },
        "back",
      ),
    );
  },
}));

vi.mock("@/settings/saved-workflows/SavedWorkflowGlobalGroup.js", () => ({
  SavedWorkflowGlobalGroup: ({
    refreshSeq,
    mode,
    onStateChange,
    onOpenDetail,
    onMoved,
    onBack,
    localProjects,
    activeProjectKey,
  }: {
    refreshSeq: number;
    mode: SavedWorkflowGroupMode;
    onStateChange: (key: "global", state: SavedWorkflowGroupState) => void;
    onOpenDetail: (name: string) => void;
    onMoved: () => void;
    onBack: () => void;
    localProjects: readonly AutomationWorkspaceOption[];
    activeProjectKey: string | null;
  }) => {
    const st = groupReadiness.global ?? { loaded: false, empty: false, count: 0 };
    useEffect(() => {
      onStateChange("global", st);
    }, [onStateChange, refreshSeq, st.count, st.empty, st.loaded]);
    return createElement(
      "div",
      {
        "data-testid": TID_WORKFLOW_GLOBAL_GROUP,
        "data-mode": mode.kind,
        "data-refresh": String(refreshSeq),
        "data-name": mode.kind === "detail" ? mode.name : "",
        "data-local": localProjects.map((p) => p.workspacePath).join(","),
        "data-active": activeProjectKey ?? "",
      },
      "global",
      createElement(
        "button",
        { type: "button", "data-testid": "global-open", onClick: () => onOpenDetail("g-1") },
        "open",
      ),
      createElement(
        "button",
        { type: "button", "data-testid": "global-moved", onClick: onMoved },
        "moved",
      ),
      createElement(
        "button",
        { type: "button", "data-testid": "global-back", onClick: onBack },
        "back",
      ),
    );
  },
}));

const { SavedWorkflowsSection } =
  await import("@/settings/saved-workflows/SavedWorkflowsSection.js");

function workspaceTab(path: string, label: string, overrides: Partial<FakeTab> = {}): FakeTab {
  return { id: `t-${path}`, kind: "workspace", workspacePath: path, label, ...overrides };
}

function mount(props: Partial<Parameters<typeof SavedWorkflowsSection>[0]> = {}) {
  const onNavigateToLaunchedRun = vi.fn();
  const onCreateViaChat = vi.fn();
  const onOpenWorkflowRun = vi.fn();
  const utils = render(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(SavedWorkflowsSection, {
        workspacePath: tabStoreState.activeWorkspacePath,
        onNavigateToLaunchedRun,
        onCreateViaChat,
        onOpenWorkflowRun,
        ...props,
      }),
    ),
  );
  return { ...utils, onNavigateToLaunchedRun, onCreateViaChat, onOpenWorkflowRun };
}

function keyOf(path: string): string {
  return resolveWorkspaceKey({ workspacePath: path });
}

describe("SavedWorkflowsSection (Global + Multi-project page)", () => {
  beforeEach(() => {
    tabStoreState.tabs = [];
    tabStoreState.activeWorkspacePath = null;
    tabStoreState.activeWorkspaceIdentity = null;
    tabStoreState.openSettingsTab = vi.fn();
    for (const k of Object.keys(groupReadiness)) delete groupReadiness[k];
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    resetDynamicWorkflowAvailabilityStoreForTests();
  });

  it("Global group is always pinned above all project groups; total = sum of global and all project group counts", async () => {
    tabStoreState.tabs = [workspaceTab("/a", "Alpha"), workspaceTab("/b", "Beta")];
    groupReadiness.global = { loaded: true, empty: false, count: 2 };
    groupReadiness["/a"] = { loaded: true, empty: false, count: 3 };
    groupReadiness["/b"] = { loaded: true, empty: false, count: 4 };
    mount();
    await screen.findByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/a")));
    const groups = screen.getAllByTestId(
      (id) => id === TID_WORKFLOW_GLOBAL_GROUP || id.startsWith(TID_WORKFLOW_PROJECT_GROUP),
    );
    expect(groups[0]?.getAttribute("data-testid")).toBe(TID_WORKFLOW_GLOBAL_GROUP);
    expect(groups[1]?.getAttribute("data-testid")).toBe(
      testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/a")),
    );
    expect(groups[2]?.getAttribute("data-testid")).toBe(
      testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/b")),
    );
    expect(screen.getByText("已保存的工作流").textContent).toContain("9");
  });

  it("全局组接收本机项目候选（过滤远程）与活动项目 key", async () => {
    tabStoreState.tabs = [
      workspaceTab("/a", "Alpha"),
      workspaceTab("/remote", "Remote", { remoteSessionId: "sess-1" }),
    ];
    tabStoreState.activeWorkspacePath = "/a";
    groupReadiness.global = { loaded: true, empty: false, count: 1 };
    groupReadiness["/a"] = { loaded: true, empty: false, count: 1 };
    mount({ workspacePath: "/a" });
    const globalGroup = await screen.findByTestId(TID_WORKFLOW_GLOBAL_GROUP);
    expect(globalGroup.getAttribute("data-local")).toBe("/a");
    expect(globalGroup.getAttribute("data-active")).toBe(keyOf("/a"));
  });

  it("Global empty state card only checks project groups: projects all empty + global has items, empty state card still appears (under global group)", async () => {
    tabStoreState.tabs = [workspaceTab("/a", "Alpha")];
    tabStoreState.activeWorkspacePath = "/a";
    groupReadiness.global = { loaded: true, empty: false, count: 3 };
    groupReadiness["/a"] = { loaded: true, empty: true, count: 0 };
    mount({ workspacePath: "/a" });
    await screen.findByTestId(TID_WORKFLOWS_EMPTY);
    const global = screen.getByTestId(TID_WORKFLOW_GLOBAL_GROUP);
    const empty = screen.getByTestId(TID_WORKFLOWS_EMPTY);
    expect(global.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("已保存的工作流").textContent).toContain("3");
  });

  it("Projects all empty and global also empty: empty state card still appears under global group", async () => {
    tabStoreState.tabs = [workspaceTab("/a", "Alpha")];
    tabStoreState.activeWorkspacePath = "/a";
    groupReadiness.global = { loaded: true, empty: true, count: 0 };
    groupReadiness["/a"] = { loaded: true, empty: true, count: 0 };
    const { onCreateViaChat } = mount({ workspacePath: "/a" });
    await screen.findByTestId(TID_WORKFLOWS_EMPTY);
    fireEvent.click(screen.getByTestId(TID_WORKFLOWS_CREATE_VIA_CHAT));
    expect(onCreateViaChat.mock.calls[0]?.[1]).toEqual({
      projectId: "t-/a",
      hostId: "local",
      workspacePath: "/a",
    });
    expect(onCreateViaChat.mock.calls[0]?.[0]).toEqual(expect.stringContaining("保存到本项目"));
  });

  it("Spinner: displayed when global and all project groups are not ready; empty state card is not displayed", async () => {
    tabStoreState.tabs = [workspaceTab("/a", "Alpha")];
    groupReadiness.global = { loaded: false, empty: false, count: 0 };
    groupReadiness["/a"] = { loaded: false, empty: false, count: 0 };
    mount();
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryByTestId(TID_WORKFLOWS_EMPTY)).toBeNull();
  });

  it("As long as global group is ready, stops spinning even if project groups are not ready", async () => {
    tabStoreState.tabs = [workspaceTab("/a", "Alpha")];
    groupReadiness.global = { loaded: true, empty: true, count: 0 };
    groupReadiness["/a"] = { loaded: false, empty: false, count: 0 };
    mount();
    await screen.findByTestId(TID_WORKFLOW_GLOBAL_GROUP);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("When there are no candidate projects, still render global group and refresh button, and show \"Open a project\" prompt", async () => {
    tabStoreState.tabs = [{ id: "s", kind: "settings", workspacePath: "", label: "settings" }];
    groupReadiness.global = { loaded: true, empty: true, count: 0 };
    mount();
    await screen.findByTestId(TID_WORKFLOW_GLOBAL_GROUP);
    expect(screen.getByText("打开一个项目以查看它的工作流。")).toBeTruthy();
    expect(screen.getByTestId(TID_WORKFLOWS_REFRESH)).toBeTruthy();
    expect(screen.queryByTestId(TID_WORKFLOWS_EMPTY)).toBeNull();
  });

  it("\"Workflow Settings\" displays current active mode; click to open settings and navigate to General", async () => {
    useDynamicWorkflowAvailabilityStore.setState({
      status: "ready",
      enabled: true,
      config: applyDynamicWorkflowUserMode(
        createDynamicWorkflowClientConfig("alwaysOn", "remote"),
        "onDemand",
      ),
    });
    groupReadiness.global = { loaded: true, empty: true, count: 0 };
    mount();
    const button = await screen.findByTestId(TID_WORKFLOWS_OPEN_SETTINGS);
    expect(button.textContent).toContain("工作流设置");
    expect(button.textContent).toContain("Enabled via command");
    fireEvent.click(button);
    expect(settingsNavigation.setPendingSettingsSectionIntent).toHaveBeenCalledWith("general");
    expect(tabStoreState.openSettingsTab).toHaveBeenCalledTimes(1);
  });

  it("Server defaults to disabled, user selected always enabled: Hub is present, and \"Workflow Settings\" is also present", async () => {
    useDynamicWorkflowAvailabilityStore.setState({
      status: "ready",
      enabled: true,
      config: applyDynamicWorkflowUserMode(
        createDynamicWorkflowClientConfig("disabled", "default"),
        "alwaysOn",
      ),
    });
    groupReadiness.global = { loaded: true, empty: true, count: 0 };
    mount();
    const button = await screen.findByTestId(TID_WORKFLOWS_OPEN_SETTINGS);
    expect(button.textContent).toContain("Always on");
  });

  it("Old Host snapshots lack offeredMode: do not show \"Workflow Settings\" link (the settings row it opens does not exist)", async () => {
    useDynamicWorkflowAvailabilityStore.setState({
      status: "ready",
      enabled: true,
      config: { mode: "alwaysOn", enabled: true, source: "remote" } as unknown as ReturnType<
        typeof createDynamicWorkflowClientConfig
      >,
    });
    groupReadiness.global = { loaded: true, empty: true, count: 0 };
    mount();
    await screen.findByTestId(TID_WORKFLOWS_REFRESH);
    expect(screen.queryByTestId(TID_WORKFLOWS_OPEN_SETTINGS)).toBeNull();
  });

  it("刷新按钮把 refreshSeq 递增并广播到全局组与所有项目组", async () => {
    tabStoreState.tabs = [workspaceTab("/a", "Alpha")];
    groupReadiness.global = { loaded: true, empty: false, count: 1 };
    groupReadiness["/a"] = { loaded: true, empty: false, count: 1 };
    mount();
    await screen.findByTestId(TID_WORKFLOW_GLOBAL_GROUP);
    expect(screen.getByTestId(TID_WORKFLOW_GLOBAL_GROUP).getAttribute("data-refresh")).toBe("0");
    fireEvent.click(screen.getByTestId(TID_WORKFLOWS_REFRESH));
    await waitFor(() =>
      expect(screen.getByTestId(TID_WORKFLOW_GLOBAL_GROUP).getAttribute("data-refresh")).toBe("1"),
    );
    expect(
      screen
        .getByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/a")))
        .getAttribute("data-refresh"),
    ).toBe("1");
  });

  it("全局组 onMoved 让两组 refreshSeq 递增", async () => {
    tabStoreState.tabs = [workspaceTab("/a", "Alpha")];
    groupReadiness.global = { loaded: true, empty: false, count: 1 };
    groupReadiness["/a"] = { loaded: true, empty: false, count: 1 };
    mount();
    await screen.findByTestId(TID_WORKFLOW_GLOBAL_GROUP);
    fireEvent.click(screen.getByTestId("global-moved"));
    await waitFor(() =>
      expect(screen.getByTestId(TID_WORKFLOW_GLOBAL_GROUP).getAttribute("data-refresh")).toBe("1"),
    );
    expect(
      screen
        .getByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/a")))
        .getAttribute("data-refresh"),
    ).toBe("1");
  });

  it("Click \"Open\" in global group to enter global details: only renders global group (detail), project groups are excluded", async () => {
    tabStoreState.tabs = [workspaceTab("/a", "Alpha")];
    groupReadiness.global = { loaded: true, empty: false, count: 1 };
    groupReadiness["/a"] = { loaded: true, empty: false, count: 1 };
    mount();
    await screen.findByTestId(TID_WORKFLOW_GLOBAL_GROUP);
    fireEvent.click(screen.getByTestId("global-open"));
    await waitFor(() =>
      expect(screen.getByTestId(TID_WORKFLOW_GLOBAL_GROUP).getAttribute("data-mode")).toBe(
        "detail",
      ),
    );
    expect(screen.getByTestId(TID_WORKFLOW_GLOBAL_GROUP).getAttribute("data-name")).toBe("g-1");
    expect(screen.queryByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/a")))).toBeNull();
    expect(screen.queryByTestId(TID_WORKFLOWS_REFRESH)).toBeNull();
    fireEvent.click(screen.getByTestId("global-back"));
    await waitFor(() =>
      expect(screen.getByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/a")))).toBeTruthy(),
    );
  });

  it("Click \"Open\" in project group to enter project details: only renders that project group, global group is excluded", async () => {
    tabStoreState.tabs = [workspaceTab("/a", "Alpha"), workspaceTab("/b", "Beta")];
    groupReadiness.global = { loaded: true, empty: false, count: 1 };
    groupReadiness["/a"] = { loaded: true, empty: false, count: 1 };
    groupReadiness["/b"] = { loaded: true, empty: false, count: 1 };
    mount();
    await screen.findByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/a")));
    fireEvent.click(screen.getByTestId("open-/a"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/a")))
          .getAttribute("data-mode"),
      ).toBe("detail"),
    );
    expect(screen.queryByTestId(TID_WORKFLOW_GLOBAL_GROUP)).toBeNull();
    expect(screen.queryByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/b")))).toBeNull();
  });

  it("Active project group has \"Current\" badge", async () => {
    tabStoreState.tabs = [workspaceTab("/a", "Alpha"), workspaceTab("/b", "Beta")];
    tabStoreState.activeWorkspacePath = "/b";
    groupReadiness.global = { loaded: true, empty: true, count: 0 };
    groupReadiness["/a"] = { loaded: true, empty: false, count: 1 };
    groupReadiness["/b"] = { loaded: true, empty: false, count: 1 };
    mount({ workspacePath: "/b" });
    await screen.findByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/a")));
    expect(
      screen
        .getByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/a")))
        .getAttribute("data-current"),
    ).toBe("false");
    expect(
      screen
        .getByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/b")))
        .getAttribute("data-current"),
    ).toBe("true");
  });

  it("深链 openWorkflow 项目变体直达项目详情并被消费", async () => {
    tabStoreState.tabs = [workspaceTab("/a", "Alpha"), workspaceTab("/b", "Beta")];
    groupReadiness.global = { loaded: true, empty: true, count: 0 };
    groupReadiness["/a"] = { loaded: true, empty: false, count: 1 };
    groupReadiness["/b"] = { loaded: true, empty: false, count: 1 };
    const onOpenWorkflowConsumed = vi.fn();
    mount({ openWorkflow: { workspaceKey: keyOf("/b"), name: "deep" }, onOpenWorkflowConsumed });
    await waitFor(() =>
      expect(
        screen
          .getByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/b")))
          .getAttribute("data-mode"),
      ).toBe("detail"),
    );
    expect(
      screen.getByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/b"))).getAttribute("data-name"),
    ).toBe("deep");
    expect(screen.queryByTestId(TID_WORKFLOW_GLOBAL_GROUP)).toBeNull();
    expect(onOpenWorkflowConsumed).toHaveBeenCalledTimes(1);
  });

  it("深链 openWorkflow 全局变体直达全局详情并被消费", async () => {
    tabStoreState.tabs = [workspaceTab("/a", "Alpha")];
    groupReadiness.global = { loaded: true, empty: false, count: 1 };
    groupReadiness["/a"] = { loaded: true, empty: false, count: 1 };
    const onOpenWorkflowConsumed = vi.fn();
    mount({ openWorkflow: { scope: "global", name: "deep-g" }, onOpenWorkflowConsumed });
    await waitFor(() =>
      expect(screen.getByTestId(TID_WORKFLOW_GLOBAL_GROUP).getAttribute("data-mode")).toBe(
        "detail",
      ),
    );
    expect(screen.getByTestId(TID_WORKFLOW_GLOBAL_GROUP).getAttribute("data-name")).toBe("deep-g");
    expect(screen.queryByTestId(testId(TID_WORKFLOW_PROJECT_GROUP, keyOf("/a")))).toBeNull();
    expect(onOpenWorkflowConsumed).toHaveBeenCalledTimes(1);
  });
});
