// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  TID_WORKFLOW_MOVE_DIALOG,
  TID_WORKFLOW_MOVE_DIALOG_SUBMIT,
  TID_WORKFLOW_MOVE_DIALOG_TARGET,
} from "@origin-ai/cf-shared";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import {
  resolveAutomationWorkspaceSelectionKey,
  type AutomationWorkspaceOption,
} from "@/settings/automationWorkspaceOptions.js";
import { SavedWorkflowMoveDialog } from "@/settings/saved-workflows/SavedWorkflowMoveDialog.js";

const ALPHA: AutomationWorkspaceOption = { workspacePath: "/repo/alpha", label: "Alpha" };
const BETA: AutomationWorkspaceOption = { workspacePath: "/repo/beta", label: "Beta" };

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
});

function mount(props: Partial<Parameters<typeof SavedWorkflowMoveDialog>[0]> = {}) {
  const merged = {
    open: true,
    entryName: "deep-research",
    targets: [ALPHA, BETA] as readonly AutomationWorkspaceOption[],
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    ...props,
  };
  render(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(SavedWorkflowMoveDialog, merged),
    ),
  );
  return merged;
}

describe("SavedWorkflowMoveDialog", () => {
  it("open 为 false 时不渲染", () => {
    mount({ open: false });
    expect(screen.queryByTestId(TID_WORKFLOW_MOVE_DIALOG)).toBeNull();
  });

  it("渲染Title与Target选择器，Default选Medium defaultTargetKey", () => {
    mount({ defaultTargetKey: resolveAutomationWorkspaceSelectionKey(BETA) });
    expect(screen.getByTestId(TID_WORKFLOW_MOVE_DIALOG)).toBeTruthy();
    expect(screen.getByText("移到Project")).toBeTruthy();
    expect(screen.getByTestId(TID_WORKFLOW_MOVE_DIALOG_TARGET).textContent).toContain("Beta");
  });

  it("Submit回带选Medium的Project", () => {
    const props = mount({ defaultTargetKey: resolveAutomationWorkspaceSelectionKey(ALPHA) });
    fireEvent.click(screen.getByTestId(TID_WORKFLOW_MOVE_DIALOG_SUBMIT));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith(ALPHA);
  });

  it("没有候选时Notice并禁用Submit", () => {
    mount({ targets: [] });
    expect(screen.queryByTestId(TID_WORKFLOW_MOVE_DIALOG_TARGET)).toBeNull();
    expect(screen.getByText("打开One个LocalProject以移动")).toBeTruthy();
    expect(
      (screen.getByTestId(TID_WORKFLOW_MOVE_DIALOG_SUBMIT) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("busy 时禁用Submit", () => {
    mount({ busy: true });
    expect(
      (screen.getByTestId(TID_WORKFLOW_MOVE_DIALOG_SUBMIT) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
