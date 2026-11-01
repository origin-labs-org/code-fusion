import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TaskActionMenuContent } from "@/TaskActionMenuContent.js";

const PIN_ITEM_INDEX = 0;
const RENAME_ITEM_INDEX = 1;
const ARCHIVE_ITEM_INDEX = 2;
const UNREAD_ITEM_INDEX = 3;
const FILE_MANAGER_ITEM_INDEX = 4;
const WORKSPACE_PATH_ITEM_INDEX = 5;
const TASK_PATH_ITEM_INDEX = 6;
const TASK_LOG_PATH_ITEM_INDEX = 7;
const PROVIDER_CONFIG_ITEM_INDEX = 8;

function renderMenu(overrides: Partial<React.ComponentProps<typeof TaskActionMenuContent>> = {}) {
  const itemStates: Array<{ disabled?: boolean }> = [];

  const html = renderToStaticMarkup(
    createElement(TaskActionMenuContent, {
      intl: {
        formatMessage: ({ id }: { id: string }) => id,
      },
      isPinned: false,
      fileManagerLabel: "Open in Finder",
      taskSessionFile: {
        loading: false,
        path: "/tmp/task/session.md",
        exists: true,
      },
      taskNativeSessionLogFile: {
        loading: false,
        path: "/tmp/task/session.jsonl",
        exists: true,
      },
      providerConfigFile: {
        loading: false,
        path: "/tmp/provider/config.json",
        exists: true,
      },
      Item: ({
        children,
        title,
        disabled,
      }: {
        children: React.ReactNode;
        title?: string;
        disabled?: boolean;
      }) => {
        itemStates.push({ disabled });
        return createElement("button", { title, disabled }, children);
      },
      Separator: () => createElement("hr"),
      onTogglePinTask: vi.fn(),
      onStartRenameTask: vi.fn(),
      onArchiveTask: vi.fn(),
      onMarkTaskAsUnread: vi.fn(),
      onOpenTaskPathInFileManager: vi.fn(),
      onCopyWorkspacePath: vi.fn(),
      onCopyTaskPath: vi.fn(),
      onCopyTaskLogPath: vi.fn(),
      onOpenProviderConfig: vi.fn(),
      ...overrides,
    }),
  );

  return {
    html,
    itemStates,
  };
}

describe("TaskActionMenuContent", () => {
  it("Retains entry when provider config file is not persisted but path is known", () => {
    const { itemStates } = renderMenu({
      providerConfigFile: {
        loading: false,
        path: "/tmp/provider/config.json",
        exists: false,
      },
    });

    expect(itemStates[PROVIDER_CONFIG_ITEM_INDEX]?.disabled).toBe(false);
  });

  it("Allows copying path when log file is not persisted but path is known", () => {
    const { itemStates } = renderMenu({
      taskNativeSessionLogFile: {
        loading: false,
        path: "/tmp/task/cf-log.jsonl",
        exists: false,
      },
    });

    expect(itemStates[TASK_LOG_PATH_ITEM_INDEX]?.disabled).toBe(false);
  });

  it("New unpersisted task only disables actions that depend on taskId", () => {
    const { itemStates } = renderMenu({
      disableTaskTargetActions: true,
    });

    expect(itemStates[PIN_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[RENAME_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[ARCHIVE_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[UNREAD_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[TASK_PATH_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[TASK_LOG_PATH_ITEM_INDEX]?.disabled).toBe(true);
    expect(itemStates[FILE_MANAGER_ITEM_INDEX]?.disabled).toBe(false);
    expect(itemStates[WORKSPACE_PATH_ITEM_INDEX]?.disabled).toBe(false);
    expect(itemStates[PROVIDER_CONFIG_ITEM_INDEX]?.disabled).toBe(false);
  });

  it("Mobile remote menu hides local files and config entries but keeps copy path", () => {
    const { html } = renderMenu({
      hideMobileUnsupportedActions: true,
    });

    expect(html).not.toContain("Open in Finder");
    expect(html).not.toContain("appHeader.goToProviderConfig");
    expect(html).toContain("appHeader.copyPath");
    expect(html).toContain("appHeader.copyTaskPath");
    expect(html).toContain("appHeader.copyLogPath");
  });

  it("No longer provides option to open in split view", () => {
    const { html } = renderMenu();

    expect(html).not.toContain("taskList.openInSplitPane");
  });
});
