// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import { CommandCenterDialog } from "@/command-center/CommandCenterDialog.js";

const fixture = vi.hoisted(() => ({
  items: [] as Array<CfTaskMeta & { searchSnippets?: string[] }>,
}));
vi.mock("@/hooks/useGlobalTaskList.js", () => ({
  useGlobalTaskList: () => ({ items: fixture.items, loading: false }),
}));
vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({ fileService: {} }),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));

function task(taskId: string, overrides: Partial<CfTaskMeta> = {}): CfTaskMeta {
  return {
    taskId,
    traceId: `trace-${taskId}`,
    title: "你好",
    workspacePath: "/workspace/project",
    createdAt: 1,
    updatedAt: 1,
    mode: "build",
    status: "completed",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  fixture.items = [task("first"), task("second"), task("third")];
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openTasks() {
  const onSelectTask = vi.fn();
  const onSearchResultHighlightRequest = vi.fn();
  render(
    createElement(CommandCenterDialog, {
      open: true,
      commands: [],
      workspaceAbsPath: "/workspace/project",
      workspaceTabs: [],
      onOpenChange: vi.fn(),
      onSelectTask,
      onSearchResultHighlightRequest,
      onOpenCodeViewer: vi.fn(),
    }),
  );
  fireEvent.click(screen.getByRole("tab", { name: "commandCenter.scope.conversations" }));
  return { onSelectTask, onSearchResultHighlightRequest };
}

async function expectOnlySelected(target: HTMLElement) {
  await waitFor(() => {
    expect(
      screen.getAllByRole("option").filter((row) => row.getAttribute("aria-selected") === "true"),
    ).toEqual([target]);
  });
}

describe("Command Center 任务行选中身份", () => {
  it("CC-SELECT-01: Duplicate-named recent tasks hit target row via hover, up/down keys, and Enter respectively", async () => {
    const { onSelectTask } = openTasks();
    const rows = screen.getAllByRole("option");
    fireEvent.pointerMove(rows[0]!);
    await expectOnlySelected(rows[0]!);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    await expectOnlySelected(rows[1]!);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowUp" });
    await expectOnlySelected(rows[0]!);
    fireEvent.pointerMove(rows[2]!);
    await expectOnlySelected(rows[2]!);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onSelectTask).toHaveBeenCalledWith("/workspace/project", "third", undefined);
  });

  it("CC-SELECT-02: Search results with identical title and body snippet can be selected and clicked independently", async () => {
    fixture.items = fixture.items.map((item) => ({ ...item, searchSnippets: ["Same body"] }));
    const { onSelectTask } = openTasks();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "你好" } });
    const rows = screen.getAllByRole("option");
    fireEvent.pointerMove(rows[1]!);
    await expectOnlySelected(rows[1]!);
    fireEvent.click(rows[1]!);
    expect(onSelectTask).toHaveBeenCalledWith("/workspace/project", "second", undefined);
  });

  it("CC-SELECT-02: Different remote workspaces with same path and task ID remain independent", async () => {
    fixture.items = ["remote-a", "remote-b"].map((workspaceIdentity) =>
      task("same-id", { workspaceIdentity }),
    );
    const { onSelectTask } = openTasks();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "你好" } });
    const rows = screen.getAllByRole("option");
    fireEvent.pointerMove(rows[1]!);
    await expectOnlySelected(rows[1]!);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onSelectTask).toHaveBeenCalledWith("/workspace/project", "same-id", "remote-b");
  });

  it("CC-SELECT-02: Multiple body snippets of the same task are independently selected and retain snippet positioning", async () => {
    fixture.items = [{ ...task("first"), searchSnippets: ["第一处你好", "第二处你好"] }];
    const { onSearchResultHighlightRequest } = openTasks();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "你好" } });
    const rows = screen.getAllByRole("option");
    fireEvent.pointerMove(rows[1]!);
    await expectOnlySelected(rows[1]!);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onSearchResultHighlightRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "first",
        snippet: "第二处你好",
      }),
    );
  });
});
