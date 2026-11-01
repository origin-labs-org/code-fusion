// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TID_WORKFLOW_DETAIL,
  TID_WORKFLOW_DETAIL_DESCRIPTION,
  TID_WORKFLOW_DETAIL_MENU,
  TID_WORKFLOW_DETAIL_PROJECT,
  TID_WORKFLOW_DETAIL_SCRIPT,
  TID_WORKFLOW_DETAIL_WHEN_TO_USE,
  TID_WORKFLOW_ACTION_MOVE,
  TID_WORKFLOW_META_DISCARD,
  TID_WORKFLOW_META_SAVE,
  TID_WORKFLOW_ARTIFACT_CHIP,
  TID_WORKFLOW_RUN_ROW,
  type CfSavedWorkflowEntry,
  type CfSavedWorkflowRun,
  type CfWorkflowsGetResult,
} from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

const toastMock = vi.fn();
vi.mock("@/components/ui/toast.js", () => ({ toast: (...args: unknown[]) => toastMock(...args) }));
vi.mock("@/components/ai-elements/code-block.js", () => ({
  CodeBlock: ({ code, language }: { code: string; language: string }) =>
    createElement("pre", { "data-script": "true", "data-language": language }, code),
}));
vi.mock("@/settings/SettingsHeaderBreadcrumb.js", () => ({
  SettingsBreadcrumbReporter: ({ items }: { items: readonly { label: string }[] }) =>
    createElement(
      "nav",
      { "data-testid": "breadcrumb" },
      items.map((item, index) => createElement("span", { key: index }, item.label)),
    ),
}));

const { SavedWorkflowDetailView } =
  await import("@/settings/saved-workflows/SavedWorkflowDetailView.js");

const SCRIPT = 'export default async ({ agent }) => {\n  await agent("Check Release");\n};\n';
const ENTRY: CfSavedWorkflowEntry = {
  name: "release-check",
  description: "发布前检查",
  whenToUse: "Pre-release",
  scope: "project",
  path: "/repo/.cf/workflows/release-check.dwf.ts",
  args: { branch: { type: "string", required: true } },
};
const detailResult: { current: CfWorkflowsGetResult } = {
  current: {
    ok: true,
    name: "release-check",
    path: ENTRY.path,
    scope: "project",
    meta: {
      description: "发布前检查",
      whenToUse: "Pre-release",
      args: { branch: { type: "string", required: true } },
    },
    script: SCRIPT,
  },
};
const agentService = {
  getSavedWorkflow: vi.fn(async () => detailResult.current),
  updateSavedWorkflowMeta: vi.fn(async () => ({ ok: true as const, path: ENTRY.path })),
};

const NOW = 1_700_000_000_000;
const RUNS: CfSavedWorkflowRun[] = [
  {
    runId: "r-open",
    name: "release-check",
    status: "completed",
    createdAt: NOW - 90_000,
    updatedAt: NOW - 60_000,
    spentTokens: 4200,
    parentSessionId: "s1",
    toolCallId: "t1",
    args: { branch: "main" },
  },
  {
    runId: "r-orphan",
    name: "release-check",
    status: "failed",
    createdAt: NOW - 5_000,
    updatedAt: NOW - 1_000,
    spentTokens: 10,
  },
];

function mount(overrides: Partial<Parameters<typeof SavedWorkflowDetailView>[0]> = {}) {
  const props = {
    target: { workspacePath: "/repo" },
    agentService: agentService as unknown as Parameters<
      typeof SavedWorkflowDetailView
    >[0]["agentService"],
    name: "release-check",
    projectLabel: "Beta",
    entry: ENTRY,
    runs: RUNS,
    now: NOW,
    busy: false,
    canOpenRun: true,
    onBack: vi.fn(),
    onRun: vi.fn(),
    onRevise: vi.fn(),
    onCopyPath: vi.fn(),
    onDelete: vi.fn(),
    onOpenRun: vi.fn(),
    onMetaSaved: vi.fn(),
    launchDialog: null,
    ...overrides,
  };
  render(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(SavedWorkflowDetailView, props),
    ),
  );
  return props;
}

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe("SavedWorkflowDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detailResult.current = {
      ok: true,
      name: "release-check",
      path: ENTRY.path,
      scope: "project",
      meta: {
        description: "发布前检查",
        whenToUse: "Pre-release",
        args: { branch: { type: "string", required: true } },
      },
      script: SCRIPT,
    };
  });
  afterEach(() => {
    cleanup();
  });

  it("Load details: metadata backfilled, argument table populated, script rendered read-only; no Save / Discard when unchanged", async () => {
    mount();
    expect(screen.getByTestId(TID_WORKFLOW_DETAIL)).toBeTruthy();
    const description = (await screen.findByTestId(
      TID_WORKFLOW_DETAIL_DESCRIPTION,
    )) as HTMLTextAreaElement;
    expect(description.value).toBe("发布前检查");
    expect((screen.getByTestId(TID_WORKFLOW_DETAIL_WHEN_TO_USE) as HTMLTextAreaElement).value).toBe(
      "Pre-release",
    );
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("branch");
    const script = screen.getByTestId(TID_WORKFLOW_DETAIL_SCRIPT);
    expect(script.querySelector("[data-script]")?.textContent).toBe(SCRIPT);
    expect(script.querySelector("[data-script]")?.getAttribute("data-language")).toBe("typescript");
    expect(script.textContent).toContain("release-check.dwf.ts");
    expect(screen.queryByTestId(TID_WORKFLOW_META_SAVE)).toBeNull();
    expect(screen.queryByTestId(TID_WORKFLOW_META_DISCARD)).toBeNull();
    expect(agentService.getSavedWorkflow).toHaveBeenCalledWith({
      workspacePath: "/repo",
      name: "release-check",
    });
  });

  it("Save / Discard appears after editing description; Discard reverts to baseline", async () => {
    mount();
    const description = (await screen.findByTestId(
      TID_WORKFLOW_DETAIL_DESCRIPTION,
    )) as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: "新说明" } });
    expect(screen.getByTestId(TID_WORKFLOW_META_SAVE)).toBeTruthy();
    fireEvent.click(screen.getByTestId(TID_WORKFLOW_META_DISCARD));
    expect((screen.getByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION) as HTMLTextAreaElement).value).toBe(
      "发布前检查",
    );
    expect(screen.queryByTestId(TID_WORKFLOW_META_SAVE)).toBeNull();
    expect(agentService.updateSavedWorkflowMeta).not.toHaveBeenCalled();
  });

  it("Save: send only meta (description / trigger timing / parameter declarations); re-fetch and notify list on success", async () => {
    const props = mount();
    const description = (await screen.findByTestId(
      TID_WORKFLOW_DETAIL_DESCRIPTION,
    )) as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: "  新说明  " } });
    fireEvent.change(screen.getByTestId(TID_WORKFLOW_DETAIL_WHEN_TO_USE), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId(TID_WORKFLOW_META_SAVE));
    await waitFor(() =>
      expect(agentService.updateSavedWorkflowMeta).toHaveBeenCalledWith({
        workspacePath: "/repo",
        name: "release-check",
        meta: { description: "新说明", args: { branch: { type: "string", required: true } } },
      }),
    );
    await waitFor(() => expect(props.onMetaSaved).toHaveBeenCalledTimes(1));
    expect(agentService.getSavedWorkflow).toHaveBeenCalledTimes(2);
    expect(toastMock).toHaveBeenCalledWith("Saved metadata");
  });

  it("Reject save and prompt when description is cleared", async () => {
    mount();
    const description = (await screen.findByTestId(
      TID_WORKFLOW_DETAIL_DESCRIPTION,
    )) as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: "   " } });
    fireEvent.click(screen.getByTestId(TID_WORKFLOW_META_SAVE));
    expect(screen.getByText("说明不能为空")).toBeTruthy();
    expect(agentService.updateSavedWorkflowMeta).not.toHaveBeenCalled();
  });

  it("Run history: one entry per row; \"View Instance\" is available only for rows with ownership fields", async () => {
    const props = mount();
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    fireEvent.mouseDown(screen.getByText("运行历史 2"), { button: 0 });
    const openable = await screen.findByTestId(testId(TID_WORKFLOW_RUN_ROW, "r-open"));
    const orphan = screen.getByTestId(testId(TID_WORKFLOW_RUN_ROW, "r-orphan"));
    expect(openable.textContent).toContain("branch=main");
    expect(openable.textContent).toContain("4.2k tokens");
    const openButton = Array.from(openable.querySelectorAll("button")).find(
      (button) => button.textContent === "View Instance",
    );
    expect(openButton).toBeTruthy();
    expect(orphan.textContent).not.toContain("View Instance");
    fireEvent.click(openButton!);
    expect(props.onOpenRun).toHaveBeenCalledWith(RUNS[0]);
  });

  it("\"View Instance\" does not appear when canOpenRun is false", async () => {
    mount({ canOpenRun: false });
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    fireEvent.mouseDown(screen.getByText("运行历史 2"), { button: 0 });
    await screen.findByTestId(testId(TID_WORKFLOW_RUN_ROW, "r-open"));
    expect(screen.queryByText("View Instance")).toBeNull();
  });

  it("Breadcrumb has only workflow name level; project ownership is shown in badge beside title", async () => {
    mount({ projectLabel: "Alpha" });
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    const crumbs = Array.from(screen.getByTestId("breadcrumb").querySelectorAll("span")).map(
      (s) => s.textContent,
    );
    expect(crumbs).toEqual(["release-check"]);
    const projectTag = screen.getByTestId(TID_WORKFLOW_DETAIL_PROJECT);
    expect(projectTag.textContent).toBe("Alpha");
    expect(projectTag.closest("button, a")).toBeNull();
  });

  it("Project ownership is still displayed next to the title when file cannot be read", async () => {
    detailResult.current = { ok: false, reason: "not_found" };
    mount({ entry: undefined, projectLabel: "Alpha" });
    await screen.findByText("这个工作流已不在项目里。");
    expect(screen.getByTestId(TID_WORKFLOW_DETAIL_PROJECT).textContent).toBe("Alpha");
  });

  it("Display a prompt instead of the form when the file no longer exists", async () => {
    detailResult.current = { ok: false, reason: "not_found" };
    mount({ entry: undefined });
    expect(await screen.findByText("这个工作流已不在项目里。")).toBeTruthy();
    expect(screen.queryByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION)).toBeNull();
  });

  it("resolveRunProject renders project column on each row, and controls \"View Instance\" via row canOpen", async () => {
    const resolveRunProject = vi.fn((run: CfSavedWorkflowRun) =>
      run.runId === "r-open"
        ? { label: "Alpha", title: "/repo/alpha", canOpen: true }
        : { label: "Beta", title: "/repo/beta", canOpen: false },
    );
    const props = mount({ resolveRunProject });
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    fireEvent.mouseDown(screen.getByText("运行历史 2"), { button: 0 });
    const openable = await screen.findByTestId(testId(TID_WORKFLOW_RUN_ROW, "r-open"));
    const project = openable.querySelector('[data-workflow-run-project="true"]');
    expect(project?.textContent).toBe("Alpha");
    expect(project?.getAttribute("title")).toBe("/repo/alpha");
    const openButton = Array.from(openable.querySelectorAll("button")).find(
      (button) => button.textContent === "View Instance",
    );
    expect(openButton).toBeTruthy();
    fireEvent.click(openButton!);
    expect(props.onOpenRun).toHaveBeenCalledWith(RUNS[0]);
  });

  it("resolveRunProject hides \"View Instance\" when row canOpen=false (even with ownership field)", async () => {
    mount({ resolveRunProject: () => ({ label: "Alpha", canOpen: false }) });
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    fireEvent.mouseDown(screen.getByText("运行历史 2"), { button: 0 });
    const openable = await screen.findByTestId(testId(TID_WORKFLOW_RUN_ROW, "r-open"));
    expect(openable.textContent).not.toContain("View Instance");
  });

  it("Do not render project column when resolveRunProject is not passed", async () => {
    mount();
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    fireEvent.mouseDown(screen.getByText("运行历史 2"), { button: 0 });
    await screen.findByTestId(testId(TID_WORKFLOW_RUN_ROW, "r-open"));
    expect(document.querySelector('[data-workflow-run-project="true"]')).toBeNull();
  });

  const ARTIFACT_RUNS: CfSavedWorkflowRun[] = [
    {
      runId: "r-latest",
      name: "release-check",
      status: "completed",
      createdAt: NOW - 90_000,
      updatedAt: NOW - 60_000,
      spentTokens: 10,
      parentSessionId: "s1",
      toolCallId: "t1",
      artifacts: [
        { id: "book", kind: "file", title: "审计报告", version: 2 },
        { id: "perf", kind: "chart", title: "每轮耗时", version: 1 },
      ],
    },
    {
      runId: "r-legacy",
      name: "release-check",
      status: "completed",
      createdAt: NOW - 5_000,
      updatedAt: NOW - 1_000,
      spentTokens: 10,
      artifacts: [{ id: "old", kind: "markdown", title: "Previous Overview", version: 1 }],
    },
  ];

  it("Run历史行在Status之后挂产物 chips；点One枚把 (run, 产物 id) 交To宿主", async () => {
    const onOpenArtifact = vi.fn();
    mount({ runs: ARTIFACT_RUNS, onOpenArtifact });
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    fireEvent.mouseDown(screen.getByText("运行历史 2"), { button: 0 });

    const row = await screen.findByTestId(testId(TID_WORKFLOW_RUN_ROW, "r-latest"));
    const chips = Array.from(row.querySelectorAll(`[data-testid="${TID_WORKFLOW_ARTIFACT_CHIP}"]`));
    expect(chips).toHaveLength(2);
    fireEvent.click(chips[0]!);
    expect(onOpenArtifact).toHaveBeenCalledWith(ARTIFACT_RUNS[0], "book");
  });

  it("没有 parentSessionId 的老行 chips 不可点——产物 tab 要回到发From它的Session", async () => {
    const onOpenArtifact = vi.fn();
    mount({ runs: ARTIFACT_RUNS, onOpenArtifact });
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    fireEvent.mouseDown(screen.getByText("运行历史 2"), { button: 0 });

    const row = await screen.findByTestId(testId(TID_WORKFLOW_RUN_ROW, "r-legacy"));
    const chip = row.querySelector(`[data-testid="${TID_WORKFLOW_ARTIFACT_CHIP}"]`);
    expect(chip?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(chip!);
    expect(onOpenArtifact).not.toHaveBeenCalled();
  });

  it("宿主没注入打开Capabilities时 chips 仍在场，只Yes全都不可点", async () => {
    mount({ runs: ARTIFACT_RUNS });
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    fireEvent.mouseDown(screen.getByText("运行历史 2"), { button: 0 });

    const row = await screen.findByTestId(testId(TID_WORKFLOW_RUN_ROW, "r-latest"));
    const chips = Array.from(row.querySelectorAll(`[data-testid="${TID_WORKFLOW_ARTIFACT_CHIP}"]`));
    expect(chips).toHaveLength(2);
    expect(chips.every((chip) => chip.hasAttribute("disabled"))).toBe(true);
  });

  it("Details页头部的「Recent产物」条取**RecentOne次 completed run**", async () => {
    const onOpenArtifact = vi.fn();
    mount({
      runs: [
        {
          runId: "r-failed",
          name: "release-check",
          status: "failed",
          createdAt: NOW - 2_000,
          updatedAt: NOW - 1_000,
          spentTokens: 0,
          parentSessionId: "s2",
        },
        ...ARTIFACT_RUNS,
      ],
      onOpenArtifact,
    });
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);

    const strip = screen.getByTestId("workflow-detail-artifacts");
    expect(strip.textContent).toContain("Recent产物");
    expect(strip.textContent).toContain("审计报告");
    fireEvent.click(strip.querySelectorAll(`[data-testid="${TID_WORKFLOW_ARTIFACT_CHIP}"]`)[1]!);
    expect(onOpenArtifact).toHaveBeenCalledWith(ARTIFACT_RUNS[0], "perf");
  });

  it("One件产物都没有时「Recent产物」条整块缺席（无则缺席）", async () => {
    mount({ onOpenArtifact: vi.fn() });
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    expect(screen.queryByTestId("workflow-detail-artifacts")).toBeNull();
  });

  it("传 onMove 时Details菜单出现Scope项：Project档「Promote to Global」", async () => {
    const onMove = vi.fn();
    mount({ onMove });
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    fireEvent.pointerDown(screen.getByTestId(TID_WORKFLOW_DETAIL_MENU), {
      button: 0,
      ctrlKey: false,
    });
    const moveItem = screen.getByTestId(testId(TID_WORKFLOW_ACTION_MOVE, "release-check"));
    expect(moveItem.textContent).toBe("提升为全局");
    fireEvent.click(moveItem);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("Global tierDetails菜单移动项为「Move to Project...」", async () => {
    mount({ entry: { ...ENTRY, scope: "global" }, onMove: vi.fn() });
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    fireEvent.pointerDown(screen.getByTestId(TID_WORKFLOW_DETAIL_MENU), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByTestId(testId(TID_WORKFLOW_ACTION_MOVE, "release-check")).textContent).toBe(
      "Move to Project...",
    );
  });

  it("不传 onMove 时Details菜单没有移动项", async () => {
    mount();
    await screen.findByTestId(TID_WORKFLOW_DETAIL_DESCRIPTION);
    fireEvent.pointerDown(screen.getByTestId(TID_WORKFLOW_DETAIL_MENU), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.queryByTestId(testId(TID_WORKFLOW_ACTION_MOVE, "release-check"))).toBeNull();
  });
});
