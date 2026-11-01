// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, createRef, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TID_WORKFLOW_LAUNCH_ARG,
  TID_WORKFLOW_LAUNCH_DIALOG,
  type CfSavedWorkflowEntry,
  type CfWorkflowsSaveResult,
} from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";

vi.mock("@/logger.js", () => ({ logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast.js", () => ({ toast: toastSpy }));
vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("@/store/TabStoreProvider.js", () => ({
  useOptionalTabStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      tabs: [
        {
          id: "t1",
          kind: "workspace",
          workspacePath: "/repo",
          label: "repo",
        },
      ],
    }),
}));
const controller = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/project-workflow/useWorkflowRunSave.js", () => ({
  useWorkflowRunSave: () => controller.current,
}));

import { CfIntlProvider } from "@/i18n/IntlProvider.js";
// eslint-disable-next-line import/first
import {
  WorkflowSavePopover,
  type WorkflowSavePopoverHost,
} from "@/components/workflow-timeline/WorkflowSavePopover.js";
// eslint-disable-next-line import/first
import {
  useWorkflowRunSaveSlots,
  type WorkflowRunSaveSlotsHost,
} from "@/project-workflow/WorkflowRunSaveControls.js";
// eslint-disable-next-line import/first
import { WorkflowCompletionCard } from "@/components/workflow-timeline/WorkflowCompletionCard.js";
// eslint-disable-next-line import/first
import { SavedWorkflowHubProvider } from "@/v4/savedWorkflowHubContext.js";
// eslint-disable-next-line import/first
import { WorkflowRunSaveSlotsBoundary } from "@/project-workflow/WorkflowRunSaveControls.js";
// eslint-disable-next-line import/first
import { ServiceProvider } from "@/hooks/useServices.js";
// eslint-disable-next-line import/first
import { WorkflowRunStatusHeader } from "@/app-shell/WorkflowRunSidePaneSections.js";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
});

const ENTRY: CfSavedWorkflowEntry = {
  name: "pr-review",
  description: "分层评审",
  scope: "project",
  path: "/repo/.cf/workflows/pr-review.dwf.ts",
};

function withIntl(node: ReactNode, locale: "en-US" | "zh-CN" = "en-US") {
  return createElement(CfIntlProvider, { initialLocale: locale }, node);
}

function popoverHost(overrides: Partial<WorkflowSavePopoverHost> = {}): WorkflowSavePopoverHost {
  return {
    runName: "pr-review",
    directSaveUnsupported: false,
    scopeLocked: false,
    saving: false,
    save: vi.fn(
      async (): Promise<CfWorkflowsSaveResult> => ({
        ok: true,
        name: "pr-review",
        scope: "project",
        path: "/p",
        overwritten: false,
      }),
    ),
    checkNameTaken: vi.fn(async () => false),
    sendLead: vi.fn(async () => undefined),
    onSaved: vi.fn(),
    ...overrides,
  };
}

function renderPopover(host: WorkflowSavePopoverHost, locale: "en-US" | "zh-CN" = "en-US") {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const anchorRef = createRef<HTMLElement | null>() as { current: HTMLElement | null };
  anchorRef.current = anchor;
  const onOpenChange = vi.fn();
  render(
    withIntl(
      createElement(WorkflowSavePopover, { anchorRef, host, onOpenChange, open: true }),
      locale,
    ),
  );
  return { onOpenChange };
}

describe("WorkflowSavePopover", () => {
  it("zh：先Yes整条宽的 CodeFusion 主路，细线之下才YesThree个Character段；名Character按 run 名预填、名Character框拿到焦点", () => {
    renderPopover(popoverHost(), "zh-CN");
    expect(screen.getByText("SaveWorkflow")).toBeTruthy();
    expect(screen.getByTestId("workflow-save-lead").textContent).toBe("让 CodeFusion 帮我提炼Save");
    expect(screen.getByText("CodeFusion 会帮你提炼出可复用的Workflow，再交你确认。")).toBeTruthy();
    expect(screen.getByText("or按原样直接Save")).toBeTruthy();
    const name = screen.getByTestId<HTMLInputElement>("workflow-save-name");
    expect(name.value).toBe("pr-review");
    expect(document.activeElement).toBe(name);
    expect(screen.getByTestId("workflow-save-consequence").textContent).toContain(
      ".cf/workflows/pr-review.dwf.ts",
    );
    expect(screen.getByTestId("workflow-save-submit").textContent).toBe("直接Save");
  });

  it("CodeFusion 主路：把填OkayCharacter段交出去，然后关掉", async () => {
    const host = popoverHost();
    const { onOpenChange } = renderPopover(host);
    fireEvent.change(screen.getByTestId("workflow-save-description"), {
      target: { value: "Three层评审" },
    });
    fireEvent.click(screen.getByTestId("workflow-save-lead"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(host.sendLead).toHaveBeenCalledWith({
      name: "pr-review",
      scope: "project",
      description: "Three层评审",
    });
  });

  it("⌘↩ 从任何Character段触发 CodeFusion 主路", async () => {
    const host = popoverHost();
    renderPopover(host);
    fireEvent.keyDown(screen.getByTestId("workflow-save-name"), { key: "Enter", metaKey: true });
    await waitFor(() => expect(host.sendLead).toHaveBeenCalledTimes(1));
  });

  it("非法名Character：helper 变成Error、「直接Save」禁用；空名Character也禁用", () => {
    renderPopover(popoverHost({ runName: "PR 分层评审" }));
    const submit = screen.getByTestId<HTMLButtonElement>("workflow-save-submit");
    expect(screen.getByTestId<HTMLInputElement>("workflow-save-name").value).toBe("");
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("workflow-save-name"), { target: { value: "a/b" } });
    expect(screen.getByTestId("workflow-save-name-helper").textContent).toBe(
      "Only letters, digits and - _ .",
    );
    expect(submit.disabled).toBe(true);
  });

  it("直接Save：按CharacterSection盘、回调 onSaved、关掉", async () => {
    const host = popoverHost();
    const { onOpenChange } = renderPopover(host);
    fireEvent.click(screen.getByTestId("workflow-save-submit"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(host.save).toHaveBeenCalledWith({
      name: "pr-review",
      scope: "project",
      meta: { description: "pr-review" },
    });
    expect(host.onSaved).toHaveBeenCalledWith({ name: "pr-review", scope: "project" });
  });

  it("名Character已被占用：探测回来就换成覆盖Warning与「覆盖并直接Save」，再点才带 overwrite", async () => {
    const host = popoverHost({ checkNameTaken: vi.fn(async (_n, scope) => scope === "project") });
    renderPopover(host);
    await waitFor(() => expect(screen.getByTestId("workflow-save-overwrite")).toBeTruthy());
    expect(screen.getByTestId("workflow-save-submit").textContent).toBe("Overwrite and save as is");
    fireEvent.click(screen.getByTestId("workflow-save-submit"));
    await waitFor(() =>
      expect(host.save).toHaveBeenCalledWith(expect.objectContaining({ overwrite: true })),
    );
  });

  it("另One档也占着这个名Character：后果句补上遮蔽那One句（按Target档说方向，句Number随语言）", async () => {
    renderPopover(popoverHost({ checkNameTaken: vi.fn(async (_n, scope) => scope === "global") }));
    await waitFor(() =>
      expect(screen.getByTestId("workflow-save-consequence").textContent).toContain(
        "A global workflow with this name will be hidden by this one.",
      ),
    );
    expect(screen.queryByTestId("workflow-save-overwrite")).toBeNull();
  });

  it("agent Deny（target_exists 之outer）：画出它的原因与Diagnostics，弹层留着——什么都没写", async () => {
    const host = popoverHost({
      save: vi.fn(
        async (): Promise<CfWorkflowsSaveResult> => ({
          ok: false,
          reason: "compile_failed",
          detail: "L1:C1 bad",
        }),
      ),
    });
    const { onOpenChange } = renderPopover(host);
    fireEvent.click(screen.getByTestId("workflow-save-submit"));
    await waitFor(() => expect(screen.getByTestId("workflow-save-failure")).toBeTruthy());
    expect(screen.getByTestId("workflow-save-failure").textContent).toContain(
      "The script did not pass typecheck; nothing was written.",
    );
    expect(screen.getByTestId("workflow-save-failure").textContent).toContain("L1:C1 bad");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("老 agent 没有 workflows/save：只留 CodeFusion 那条路，Notice里说清楚", () => {
    renderPopover(popoverHost({ directSaveUnsupported: true }));
    expect(screen.getByTestId("workflow-save-lead")).toBeTruthy();
    expect(screen.queryByTestId("workflow-save-name")).toBeNull();
    expect(screen.queryByText("or save it as is")).toBeNull();
    expect(screen.getByText(/This agent cannot save directly\./u)).toBeTruthy();
  });

  it("宿主没有Send路径：没有 CodeFusion 那One枚、也没有分隔线，只剩Character段", () => {
    const host = popoverHost();
    delete host.sendLead;
    renderPopover(host);
    expect(screen.queryByTestId("workflow-save-lead")).toBeNull();
    expect(screen.queryByText("or save it as is")).toBeNull();
    expect(screen.getByTestId("workflow-save-name")).toBeTruthy();
  });
});

interface ControllerOverrides {
  entry?: CfSavedWorkflowEntry;
  runArgs?: Record<string, unknown>;
  launch?: ReturnType<typeof vi.fn>;
}

function setController(overrides: ControllerOverrides = {}) {
  controller.current = {
    saved:
      overrides.entry === undefined
        ? { status: "ready" }
        : { status: "ready", entry: overrides.entry },
    entry: overrides.entry,
    runArgs: overrides.runArgs,
    directSaveUnsupported: false,
    scopeLocked: false,
    saving: false,
    save: vi.fn(),
    checkNameTaken: vi.fn(async () => false),
    launching: false,
    launchError: null,
    clearLaunchError: vi.fn(),
    launch: overrides.launch ?? vi.fn(async () => ({ ok: true })),
  };
}

function CardWithSlots({ host }: { host: WorkflowRunSaveSlotsHost }) {
  const { leading, trailing } = useWorkflowRunSaveSlots(host);
  return createElement(WorkflowCompletionCard, {
    artifacts: [],
    figures: {},
    name: "PR 分层评审",
    testIdKey: "t",
    ...(leading === null ? {} : { headerLeading: leading }),
    ...(trailing === null ? {} : { headerTrailing: trailing }),
  });
}

function renderSlots(
  host: Partial<WorkflowRunSaveSlotsHost> = {},
  options: { hub?: { openWorkflow: ReturnType<typeof vi.fn> } } = {},
) {
  const card = createElement(CardWithSlots, {
    host: {
      workspacePath: "/repo",
      runId: "run-1",
      runName: "PR 分层评审",
      canSave: true,
      sendLead: vi.fn(async () => undefined),
      ...host,
    },
  });
  return render(
    withIntl(
      options.hub === undefined
        ? card
        : createElement(SavedWorkflowHubProvider, {
            openWorkflow: options.hub.openWorkflow,
            navigateToRun: vi.fn(),
            children: card,
          }),
    ),
  );
}

describe("表头槽位", () => {
  beforeEach(() => setController());

  it("还没Save：只有「Save」，没有芯片；点开就Yes那个弹层", () => {
    renderSlots();
    expect(screen.queryByTestId("workflow-saved-chip")).toBeNull();
    const save = screen.getByTestId("workflow-save-open");
    expect(save.getAttribute("aria-label")).toBe("Save");
    fireEvent.click(save);
    expect(screen.getByTestId("workflow-save-popover")).toBeTruthy();
  });

  it("已Save：芯片在Status之前、动词换成「再次Run」；没有Medium枢时芯片只YesTextCharacter", () => {
    setController({ entry: ENTRY });
    renderSlots();
    const chip = screen.getByTestId("workflow-saved-chip");
    expect(chip.tagName).toBe("SPAN");
    expect(chip.textContent).toBe("Saved");
    expect(screen.getByTestId("workflow-save-run-again").getAttribute("aria-label")).toBe(
      "Run again",
    );
    expect(screen.queryByTestId("workflow-save-open")).toBeNull();
  });

  it("有Medium枢：芯片Yes按钮，点开落到那个Workflow", () => {
    setController({ entry: ENTRY });
    const openWorkflow = vi.fn();
    renderSlots({}, { hub: { openWorkflow } });
    const chip = screen.getByTestId("workflow-saved-chip");
    expect(chip.tagName).toBe("BUTTON");
    fireEvent.click(chip);
    expect(openWorkflow).toHaveBeenCalledWith({
      name: "pr-review",
      scope: "project",
      workspacePath: "/repo",
    });
  });

  it("门关着（只读 / 灰度）：芯片Yes事实照常在，动词整个缺席", () => {
    setController({ entry: ENTRY });
    renderSlots({ canSave: false });
    expect(screen.getByTestId("workflow-saved-chip")).toBeTruthy();
    expect(screen.queryByTestId("workflow-save-run-again")).toBeNull();
    expect(screen.queryByTestId("workflow-save-open")).toBeNull();
  });

  it("再次Run：无实参的Project档直接Start，不开窗", async () => {
    const launch = vi.fn(async () => ({ ok: true }));
    setController({ entry: ENTRY, launch });
    renderSlots();
    fireEvent.click(screen.getByTestId("workflow-save-run-again"));
    await waitFor(() => expect(launch).toHaveBeenCalledWith(ENTRY, {}));
    expect(screen.queryByTestId(TID_WORKFLOW_LAUNCH_DIALOG)).toBeNull();
  });

  it("再次Run直接Failed to start：toast 说出Start器的原因（窗outer路径）", async () => {
    toastSpy.mockClear();
    const launch = vi.fn(async () => ({
      ok: false,
      error: { reason: "compile_failed", code: "x" },
    }));
    setController({ entry: ENTRY, launch });
    renderSlots();
    fireEvent.click(screen.getByTestId("workflow-save-run-again"));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy).toHaveBeenCalledWith("The workflow script did not compile");
  });

  it("再次Run：有实参就开窗，预填这次 run Run过的那One份", async () => {
    const entry: CfSavedWorkflowEntry = {
      ...ENTRY,
      args: { base: { type: "string", default: "main" } },
    };
    const launch = vi.fn(async () => ({ ok: true }));
    setController({ entry, runArgs: { base: "release/3.14" }, launch });
    renderSlots();
    await act(async () => {
      fireEvent.click(screen.getByTestId("workflow-save-run-again"));
    });
    expect(screen.getByTestId(TID_WORKFLOW_LAUNCH_DIALOG)).toBeTruthy();
    expect(
      screen.getByTestId<HTMLInputElement>(testId(TID_WORKFLOW_LAUNCH_ARG, "base")).value,
    ).toBe("release/3.14");
    expect(launch).not.toHaveBeenCalled();
  });
});

describe("WorkflowRunSaveSlotsBoundary", () => {
  beforeEach(() => setController({ entry: ENTRY }));
  const host: WorkflowRunSaveSlotsHost = { workspacePath: "/repo", runId: "run-1", canSave: true };

  it("没有ServiceContext（静态渲染、回放、分享只读）：不挂控制器，卡就Yes原来那张卡", () => {
    const seen: unknown[] = [];
    render(
      withIntl(
        createElement(WorkflowRunSaveSlotsBoundary, {
          host,
          children: (slots) => {
            seen.push(slots);
            return null;
          },
        }),
      ),
    );
    expect(seen).toEqual([null]);
  });

  it("有ServiceContext：交出两个槽位", () => {
    let seen: unknown = undefined;
    render(
      withIntl(
        createElement(ServiceProvider, {
          services: {} as never,
          children: createElement(WorkflowRunSaveSlotsBoundary, {
            host,
            children: (slots) => {
              seen = slots;
              return null;
            },
          }),
        }),
      ),
    );
    expect(seen).toMatchObject({ leading: expect.anything(), trailing: expect.anything() });
  });
});

describe("run 侧板Status头", () => {
  function renderHeader(saveSlots: { leading: ReactNode; trailing: ReactNode } | null) {
    return render(
      withIntl(
        createElement(WorkflowRunStatusHeader, {
          cancellable: false,
          onCancel: () => {},
          onResume: () => {},
          resumable: false,
          run: {
            runId: "r",
            status: "completed",
            usage: { spentTokens: 0, nodesUsed: 0 },
            actors: [],
            nodes: [],
            lastEventSequence: 0,
          },
          saveSlots,
          summaryParts: undefined,
          title: "pr-review",
          usage: undefined,
        }),
      ),
    );
  }

  it("动词排在 Stop 之前，芯片在第Two行Status词之后", () => {
    renderHeader({
      leading: createElement("span", { "data-testid": "chip" }, "Saved"),
      trailing: createElement("button", { "data-testid": "verb", type: "button" }, "Run again"),
    });
    const verb = screen.getByTestId("verb");
    const stop = screen.getByTestId("workflow-run-cancel");
    expect(verb.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const row = screen.getByTestId("workflow-run-status-row");
    expect(row.contains(screen.getByTestId("chip"))).toBe(true);
    expect(
      screen
        .getByTestId("workflow-run-status")
        .compareDocumentPosition(screen.getByTestId("chip")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
