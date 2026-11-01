// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { GroupItem } from "@/project-sidebar/grouped/group-item.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/ControlHintTooltip.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ControlHintTooltip.js")>()),
  ControlHintTooltip: ({ children }: { children: ReactNode }) => children,
}));
const onRename = vi.fn();
function mount() {
  const props: ComponentProps<typeof GroupItem> = {
    node: {
      type: "group",
      group: { id: "g", title: "New group", color: "gray", createdAt: 1, updatedAt: 1 },
      tasks: [],
    },
    groups: [],
    activeWorkspacePath: "/workspace",
    activeTaskId: null,
    getTaskRemoteSessionId: () => undefined,
    getTaskWorkspaceLabel: () => "workspace",
    onSelectTask: vi.fn(),
    onCloseTask: vi.fn(),
    onCreateTask: vi.fn(),
    onRenameGroup: onRename,
    onUpdateGroupColor: vi.fn(),
    onUngroupGroup: vi.fn(),
    onMoveTaskToGroup: vi.fn(),
    onMoveTaskToTop: vi.fn(),
    onStartRenameTask: vi.fn(),
    onArchiveTask: vi.fn(),
    onMarkTaskAsUnread: vi.fn(),
    newGroupSetup: true,
    onNewGroupSetupStarted: vi.fn(),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
  };
  render(createElement(GroupItem, props));
  return screen.getByTestId("task-group-title-input") as HTMLInputElement;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("Refocusing on menu close must not re-select the entered name", () => {
  const input = mount();
  fireEvent.change(input, { target: { value: "E2E_GROUP" } });
  input.setSelectionRange(input.value.length, input.value.length);
  act(() => {
    vi.advanceTimersByTime(50);
  });
  expect(input.selectionStart).toBe(input.value.length);
  expect(input.selectionEnd).toBe(input.value.length);
});
it("Renaming only disables dragging, input field must not inherit disabled state", () => {
  const input = mount();
  expect(input.closest('[aria-disabled="true"]')).toBeNull();
});
it("Fast Enter explicitly submits, unaffected by menu initial focus protection; IME Enter maintains editing", () => {
  const input = mount();
  act(() => {
    input.focus();
  });
  fireEvent.change(input, { target: { value: "E2E_GROUP" } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onRename).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onRename).toHaveBeenCalledWith("g", "E2E_GROUP");
});
