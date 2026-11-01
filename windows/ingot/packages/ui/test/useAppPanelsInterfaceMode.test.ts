// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppPanels } from "@/hooks/useAppPanels.js";
import { clearTaskSidePaneMemoryStateForTest } from "@/lib/taskSidePaneMemory.js";

const mode = vi.hoisted(() => ({ general: false }));
vi.mock("@/hooks/useInterfaceMode.js", () => ({ useIsOfficeMode: () => mode.general }));
vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({ cfSessionService: { closeSession: vi.fn(async () => {}) } }),
}));

function renderPanels() {
  return renderHook(() =>
    useAppPanels({
      workspaceAbsPath: "/repo",
      workspaceIdentity: "ssh://mode-test/repo",
      workspaceRemoteSessionId: "remote-mode-test",
      activeTaskId: "mode-task",
      sidePaneOwnerId: "mode-task",
      isDesktop: true,
      isWorkspaceVisible: true,
      supportsEmbeddedBrowser: true,
      defaultWhiteboardNamePrefix: "Whiteboard",
    }),
  );
}

describe("Mode切换不改写已打开面板", () => {
  beforeEach(() => {
    mode.general = false;
    clearTaskSidePaneMemoryStateForTest();
  });
  afterEach(() => clearTaskSidePaneMemoryStateForTest());

  it("RetainTerminal、Review、EventsTagsand折叠Status，同时禁止New", () => {
    const { result, rerender, unmount } = renderPanels();
    act(() => result.current.handleOpenGit());
    act(() => result.current.handleOpenTerminalTab());
    act(() => result.current.handleToggleTerminal());
    const before = result.current.sidePaneState;
    const collapsed = result.current.isSidePaneCollapsed;
    expect(before?.tabs.map((tab) => tab.type)).toEqual(["git", "terminal"]);
    expect(result.current.isTerminalOpen).toBe(true);
    mode.general = true;
    rerender();
    expect(result.current.sidePaneState).toEqual(before);
    expect(result.current.isTerminalOpen).toBe(true);
    expect(result.current.isSidePaneCollapsed).toBe(collapsed);
    act(() => result.current.handleOpenTerminalTab());
    expect(result.current.sidePaneState).toEqual(before);
    act(() => result.current.handleToggleTerminal());
    expect(result.current.isTerminalOpen).toBe(false);
    act(() => result.current.handleToggleTerminal());
    expect(result.current.isTerminalOpen).toBe(false);
    mode.general = false;
    rerender();
    expect(result.current.sidePaneState).toEqual(before);
    unmount();
  });

  it("General ModeClose已有Tags后不能PassedRecentClose入口恢复RevieworTerminal", async () => {
    const { result, rerender, unmount } = renderPanels();
    act(() => result.current.handleOpenGit());
    const gitId = result.current.sidePaneState!.activeTabId;
    mode.general = true;
    rerender();
    await act(async () => result.current.handleCloseSidePaneTab(gitId));
    expect(result.current.sidePaneState).toBeNull();
    expect(result.current.recentClosedSidePaneTabs).toEqual([]);
    act(() => result.current.handleReopenClosedSidePaneTab(gitId));
    act(() => result.current.handleOpenGit());
    expect(result.current.sidePaneState).toBeNull();
    mode.general = false;
    rerender();
    expect(result.current.recentClosedSidePaneTabs.map((item) => item.tab.id)).toContain(gitId);
    act(() => result.current.handleReopenClosedSidePaneTab(gitId));
    expect(result.current.sidePaneState?.activeTabId).toBe(gitId);
    unmount();
  });
});
