// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  TID_WORKFLOW_LAUNCH_ARG,
  TID_WORKFLOW_LAUNCH_DIALOG,
  TID_WORKFLOW_LAUNCH_ERROR,
  TID_WORKFLOW_LAUNCH_FIELDS,
  TID_WORKFLOW_LAUNCH_SUBMIT,
  TID_WORKFLOW_LAUNCH_TARGET,
  type CfSavedWorkflowArgsDeclaration,
  type CfSavedWorkflowEntry,
} from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import {
  resolveAutomationWorkspaceSelectionKey,
  type AutomationWorkspaceOption,
} from "@/settings/automationWorkspaceOptions.js";
import { SavedWorkflowLaunchDialog } from "@/settings/saved-workflows/SavedWorkflowLaunchDialog.js";
import type { SavedWorkflowLaunchError } from "@/settings/saved-workflows/useSavedWorkflowLauncher.js";

const ENTRY: CfSavedWorkflowEntry = {
  name: "release-check",
  description: "发布前检查",
  scope: "project",
  path: "/repo/.cf/workflows/release-check.dwf.ts",
  args: {
    branch: { type: "string", required: true, description: "Target Branch" },
    count: { type: "number", default: 3 },
    dry: { type: "boolean", default: true },
    extra: { type: "json" },
  },
};

const GLOBAL_ENTRY: CfSavedWorkflowEntry = {
  name: "deep-research",
  description: "深度Research",
  scope: "global",
  path: "/home/.cf/workflows/deep-research.dwf.ts",
};

const MANY_ARGS_REQUIRED = "arg12";
const MANY_ARGS_JSON = "arg30";
const MANY_ARGS: CfSavedWorkflowArgsDeclaration = {};
for (let index = 0; index < 40; index += 1) {
  const name = `arg${String(index).padStart(2, "0")}`;
  MANY_ARGS[name] =
    name === MANY_ARGS_REQUIRED
      ? { type: "string", required: true }
      : name === MANY_ARGS_JSON
        ? { type: "json" }
        : { type: "string", default: `v${index}` };
}
const MANY_ARGS_ENTRY: CfSavedWorkflowEntry = {
  name: "arg-overflow",
  description: "实参很多",
  scope: "global",
  path: "/home/.cf/workflows/arg-overflow.dwf.ts",
  args: MANY_ARGS,
};

const ALPHA: AutomationWorkspaceOption = { workspacePath: "/repo/alpha", label: "Alpha" };
const BETA: AutomationWorkspaceOption = { workspacePath: "/repo/beta", label: "Beta" };
const TARGETS: readonly AutomationWorkspaceOption[] = [ALPHA, BETA];

const scrollIntoView = vi.fn();

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  scrollIntoView.mockClear();
});

function mount(
  entry: CfSavedWorkflowEntry | null,
  extra: {
    targets?: readonly AutomationWorkspaceOption[];
    defaultTargetKey?: string | null;
    scope?: "project" | "global";
    projectLabel?: string;
    pending?: boolean;
    error?: SavedWorkflowLaunchError | null;
  } = {},
  onSubmit = vi.fn(),
  onOpenChange = vi.fn(),
) {
  const { scope, projectLabel, ...rest } = extra;
  render(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(SavedWorkflowLaunchDialog, {
        entry,
        scope: scope ?? entry?.scope ?? "project",
        projectLabel: projectLabel ?? "Beta",
        onOpenChange,
        onSubmit,
        ...rest,
      }),
    ),
  );
  return { onSubmit, onOpenChange };
}

describe("SavedWorkflowLaunchDialog", () => {
  it("entry 为 null 时不渲染", () => {
    mount(null);
    expect(screen.queryByTestId(TID_WORKFLOW_LAUNCH_DIALOG)).toBeNull();
  });

  it("按类型出控件并回填Default value；required Label注；Description可见", () => {
    mount(ENTRY);
    expect(screen.getByTestId(TID_WORKFLOW_LAUNCH_DIALOG)).toBeTruthy();
    expect(screen.getByText("release-check")).toBeTruthy();
    expect(screen.getByText("项目")).toBeTruthy();
    expect(screen.getByText("发布前检查")).toBeTruthy();
    const branch = screen.getByTestId(
      testId(TID_WORKFLOW_LAUNCH_ARG, "branch"),
    ) as HTMLInputElement;
    expect(branch.type).toBe("text");
    expect(branch.value).toBe("");
    expect(screen.getByText("必填")).toBeTruthy();
    expect(screen.getByText("Target Branch")).toBeTruthy();
    const count = screen.getByTestId(testId(TID_WORKFLOW_LAUNCH_ARG, "count")) as HTMLInputElement;
    expect(count.type).toBe("number");
    expect(count.value).toBe("3");
    const dry = screen.getByTestId(testId(TID_WORKFLOW_LAUNCH_ARG, "dry"));
    expect(dry.getAttribute("role")).toBe("switch");
    expect(dry.getAttribute("aria-checked")).toBe("true");
    const extra = screen.getByTestId(testId(TID_WORKFLOW_LAUNCH_ARG, "extra"));
    expect(extra.tagName).toBe("TEXTAREA");
  });

  it("Submit前One次收齐 required 与 json Error；修正后Submit拿到按类型解析的实参", () => {
    const { onSubmit } = mount(ENTRY);
    fireEvent.change(screen.getByTestId(testId(TID_WORKFLOW_LAUNCH_ARG, "extra")), {
      target: { value: "{oops" },
    });
    fireEvent.click(screen.getByTestId(TID_WORKFLOW_LAUNCH_SUBMIT));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText("必填")).toHaveLength(2);
    expect(screen.getByText("不Yes合法的 JSON")).toBeTruthy();

    fireEvent.change(screen.getByTestId(testId(TID_WORKFLOW_LAUNCH_ARG, "branch")), {
      target: { value: "main" },
    });
    fireEvent.change(screen.getByTestId(testId(TID_WORKFLOW_LAUNCH_ARG, "extra")), {
      target: { value: '{"a":1}' },
    });
    expect(screen.getAllByText("必填")).toHaveLength(1);
    expect(screen.queryByText("不Yes合法的 JSON")).toBeNull();
    fireEvent.change(screen.getByTestId(testId(TID_WORKFLOW_LAUNCH_ARG, "count")), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId(TID_WORKFLOW_LAUNCH_SUBMIT));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({ branch: "main", dry: true, extra: { a: 1 } });
  });

  it("Cancel按钮Close Window", () => {
    const { onOpenChange, onSubmit } = mount(ENTRY);
    fireEvent.click(screen.getByText("取消"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("不传 targets 时不渲染「Run于」选择器（Project档路径）", () => {
    mount(ENTRY);
    expect(screen.queryByTestId(TID_WORKFLOW_LAUNCH_TARGET)).toBeNull();
    expect(screen.queryByText("Run于")).toBeNull();
  });

  it("传 targets 时渲染选择器，Default选Medium defaultTargetKey", () => {
    mount(GLOBAL_ENTRY, {
      targets: TARGETS,
      defaultTargetKey: resolveAutomationWorkspaceSelectionKey(BETA),
    });
    expect(screen.getByText("Run于")).toBeTruthy();
    const trigger = screen.getByTestId(TID_WORKFLOW_LAUNCH_TARGET);
    expect(trigger.textContent).toContain("Beta");
  });

  it("defaultTargetKey 不在候选里时回落到首个候选", () => {
    mount(GLOBAL_ENTRY, { targets: TARGETS, defaultTargetKey: "no-such-key" });
    expect(screen.getByTestId(TID_WORKFLOW_LAUNCH_TARGET).textContent).toContain("Alpha");
  });

  it("候选为空时Notice并禁用Submit", () => {
    mount(GLOBAL_ENTRY, { targets: [] });
    expect(screen.queryByTestId(TID_WORKFLOW_LAUNCH_TARGET)).toBeNull();
    expect(screen.getByText("打开One个LocalProject以Run")).toBeTruthy();
    expect((screen.getByTestId(TID_WORKFLOW_LAUNCH_SUBMIT) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("无实参的全局Workflow也弹窗，Submit回带选Medium的Project", () => {
    const { onSubmit } = mount(GLOBAL_ENTRY, {
      targets: TARGETS,
      defaultTargetKey: resolveAutomationWorkspaceSelectionKey(ALPHA),
    });
    expect(screen.getByTestId(TID_WORKFLOW_LAUNCH_DIALOG)).toBeTruthy();
    fireEvent.click(screen.getByTestId(TID_WORKFLOW_LAUNCH_SUBMIT));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[1]).toEqual({});
    expect(onSubmit.mock.calls[0]?.[2]).toEqual(ALPHA);
  });

  it("Global tier头部渲染「全局」徽Label", () => {
    mount(GLOBAL_ENTRY, { targets: TARGETS, scope: "global" });
    expect(screen.getByText("deep-research")).toBeTruthy();
    expect(screen.getByText("全局")).toBeTruthy();
  });

  it("DescriptionCopy带Project名：Project档用所属Project名", () => {
    mount(ENTRY, { projectLabel: "Beta" });
    expect(screen.getByText("k立即在 Beta Run in a new session of")).toBeTruthy();
  });

  it("DescriptionCopy带Project名：Global tier用选Medium的「Run于」Project名", () => {
    mount(GLOBAL_ENTRY, {
      targets: TARGETS,
      scope: "global",
      defaultTargetKey: resolveAutomationWorkspaceSelectionKey(ALPHA),
    });
    expect(screen.getByText("k立即在 Alpha Run in a new session of")).toBeTruthy();
  });

  it("pending 时禁用Submit按钮，且点击不再发From", () => {
    const { onSubmit } = mount(GLOBAL_ENTRY, {
      targets: TARGETS,
      scope: "global",
      defaultTargetKey: resolveAutomationWorkspaceSelectionKey(ALPHA),
      pending: true,
    });
    const submit = screen.getByTestId(TID_WORKFLOW_LAUNCH_SUBMIT) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("行innerError区按 reason 出Title，并把Service端 message 放进 mono 块", () => {
    const error: SavedWorkflowLaunchError = {
      reason: "compile_failed",
      code: "fault.command.savedWorkflowStartRejected.compile_failed",
      message: "line 3: boom",
    };
    mount(GLOBAL_ENTRY, { targets: TARGETS, scope: "global", error });
    const region = screen.getByTestId(TID_WORKFLOW_LAUNCH_ERROR);
    expect(region.textContent).toContain("工作流脚本编译失败");
    expect(region.textContent).toContain("line 3: boom");
  });

  it("Capabilities缺席Error映射到 unsupported Copy；无 message 时不渲染 mono 块", () => {
    const error: SavedWorkflowLaunchError = {
      reason: "unsupported",
      code: "fault.command.capabilityUnsupported",
    };
    mount(GLOBAL_ENTRY, { targets: TARGETS, scope: "global", error });
    const region = screen.getByTestId(TID_WORKFLOW_LAUNCH_ERROR);
    expect(region.textContent).toContain("Current agent 不支持直接StartWorkflow");
    expect(region.querySelector("pre")).toBeNull();
  });

  it("只有「Run于」与实参Character段在滚动区inner；Description、Error区、按钮钉在滚动区outer", () => {
    const error: SavedWorkflowLaunchError = {
      reason: "compile_failed",
      code: "fault.command.savedWorkflowStartRejected.compile_failed",
      message: "line 3: boom",
    };
    mount(MANY_ARGS_ENTRY, { targets: TARGETS, scope: "global", projectLabel: "Alpha", error });
    const dialog = screen.getByTestId(TID_WORKFLOW_LAUNCH_DIALOG);
    const fields = screen.getByTestId(TID_WORKFLOW_LAUNCH_FIELDS);
    expect(dialog.contains(fields)).toBe(true);
    expect(fields.contains(screen.getByTestId(TID_WORKFLOW_LAUNCH_TARGET))).toBe(true);
    for (const name of Object.keys(MANY_ARGS)) {
      expect(fields.contains(screen.getByTestId(testId(TID_WORKFLOW_LAUNCH_ARG, name)))).toBe(true);
    }
    const pinned = [
      screen.getByText("arg-overflow"),
      screen.getByText("k立即在 Alpha Run in a new session of"),
      screen.getByTestId(TID_WORKFLOW_LAUNCH_ERROR),
      screen.getByText("取消"),
      screen.getByTestId(TID_WORKFLOW_LAUNCH_SUBMIT),
    ];
    for (const element of pinned) {
      expect(dialog.contains(element)).toBe(true);
      expect(fields.contains(element)).toBe(false);
    }
  });

  it("没有「Run于」也没有实参时不渲染滚动区", () => {
    mount({ ...GLOBAL_ENTRY, scope: "project" });
    expect(screen.getByTestId(TID_WORKFLOW_LAUNCH_DIALOG)).toBeTruthy();
    expect(screen.queryByTestId(TID_WORKFLOW_LAUNCH_FIELDS)).toBeNull();
  });

  it("校验Failed：第One个出WrongCharacter段被滚进视野并拿到焦点", () => {
    const { onSubmit } = mount(MANY_ARGS_ENTRY, { targets: TARGETS, scope: "global" });
    const required = screen.getByTestId(testId(TID_WORKFLOW_LAUNCH_ARG, MANY_ARGS_REQUIRED));
    const json = screen.getByTestId(testId(TID_WORKFLOW_LAUNCH_ARG, MANY_ARGS_JSON));
    fireEvent.change(json, { target: { value: "{oops" } });
    fireEvent.click(screen.getByTestId(TID_WORKFLOW_LAUNCH_SUBMIT));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(required);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const revealed = scrollIntoView.mock.contexts[0] as HTMLElement;
    expect(revealed.contains(required)).toBe(true);
    expect(revealed.textContent).toContain("必填");
    expect(revealed.contains(json)).toBe(false);

    fireEvent.change(required, { target: { value: "prod" } });
    fireEvent.click(screen.getByTestId(TID_WORKFLOW_LAUNCH_SUBMIT));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(json);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("校验Passed时不滚动", () => {
    const { onSubmit } = mount(ENTRY);
    fireEvent.change(screen.getByTestId(testId(TID_WORKFLOW_LAUNCH_ARG, "branch")), {
      target: { value: "main" },
    });
    fireEvent.click(screen.getByTestId(TID_WORKFLOW_LAUNCH_SUBMIT));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
