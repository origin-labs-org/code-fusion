// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TID_WORKFLOWS_CREATE_VIA_CHAT,
  TID_WORKFLOWS_LIST,
  TID_WORKFLOW_ACTION_DELETE,
  TID_WORKFLOW_ACTION_MOVE,
  TID_WORKFLOW_CARD,
  TID_WORKFLOW_CARD_RUN,
  TID_WORKFLOW_DETAIL,
  TID_WORKFLOW_PROJECT_GROUP,
  type CfSavedWorkflowEntry,
  type CfSavedWorkflowRun,
  type CfWorkflowsListResult,
} from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";
import type { AutomationWorkspaceOption } from "@/settings/automationWorkspaceOptions.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { resetSavedWorkflowStoreForTests } from "@/store/savedWorkflowStore.js";

const confirmMock = vi.fn(async () => true);
const toastMock = vi.fn();
let changeListener: (() => void) | null = null;
const watcherDispose = vi.fn();
const fileWatcherService = {
  watch: vi.fn(async () => ({ id: "watch-1" })),
  onDynamicChange: vi.fn(() => (listener: () => void) => {
    changeListener = listener;
    return { dispose: watcherDispose };
  }),
  unwatch: vi.fn(async () => {}),
};

function makeAgent() {
  const listResult: { current: CfWorkflowsListResult } = {
    current: { workflows: [], invalid: [], dir: "/beta/.cf/workflows" },
  };
  const runsResult: { current: CfSavedWorkflowRun[] } = { current: [] };
  const agent = {
    listResult,
    runsResult,
    listSavedWorkflows: vi.fn(async () => listResult.current),
    listSavedWorkflowRuns: vi.fn(async () => ({ runs: runsResult.current })),
    deleteSavedWorkflow: vi.fn(async () => ({
      ok: true as const,
      path: "/beta/.cf/workflows/x.dwf.ts",
    })),
    getSavedWorkflow: vi.fn(),
    updateSavedWorkflowMeta: vi.fn(),
  };
  return agent;
}
const agentBeta = makeAgent();
const agentRepo = makeAgent();
const agentByPath: Record<string, ReturnType<typeof makeAgent>> = {
  "/beta": agentBeta,
  "/repo": agentRepo,
};

vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServicesResolution: (workspacePath: string) => ({
    services: { cfAgentService: agentByPath[workspacePath] ?? agentRepo, fileWatcherService },
    remoteSessionId: null,
    isRemoteTarget: false,
    connectionKind: "local-ready" as const,
    rpcReady: true,
  }),
}));
vi.mock("@/hooks/useConfirmDialog.js", () => ({ useConfirmDialog: () => confirmMock }));
vi.mock("@/components/ui/toast.js", () => ({ toast: (...args: unknown[]) => toastMock(...args) }));
const launchMock = vi.fn(async () => ({
  ok: true as const,
  sessionId: "s-1",
  runId: "r-1",
  toolCallId: "launch-1",
}));
const clearErrorMock = vi.fn();
vi.mock("@/settings/saved-workflows/useSavedWorkflowLauncher.js", () => ({
  useSavedWorkflowLauncher: () => ({
    launch: launchMock,
    pending: false,
    error: null,
    clearError: clearErrorMock,
  }),
}));
const promoteMock = vi.fn(async () => ({ ok: true as const, sessionId: "s-p" }));
vi.mock("@/settings/saved-workflows/useSavedWorkflowPromote.js", () => ({
  useSavedWorkflowPromote: () => ({ promote: promoteMock, pending: false }),
}));
vi.mock("@/settings/saved-workflows/SavedWorkflowCard.js", () => ({
  SavedWorkflowCard: ({
    entry,
    lastRun,
    onOpen,
    onRun,
    onRevise,
    onMove,
    onDelete,
  }: {
    entry: CfSavedWorkflowEntry;
    lastRun: CfSavedWorkflowRun | undefined;
    onOpen: (entry: CfSavedWorkflowEntry) => void;
    onRun: (entry: CfSavedWorkflowEntry) => void;
    onRevise: (entry: CfSavedWorkflowEntry) => void;
    onMove?: (entry: CfSavedWorkflowEntry) => void;
    onDelete: (entry: CfSavedWorkflowEntry) => void;
  }) =>
    createElement(
      "div",
      {
        "data-testid": testId(TID_WORKFLOW_CARD, entry.name),
        "data-last-run": lastRun?.runId ?? "",
      },
      entry.name,
      createElement("button", { type: "button", onClick: () => onOpen(entry) }, "open"),
      createElement(
        "button",
        { type: "button", onClick: () => onRevise(entry), "data-testid": `revise-${entry.name}` },
        "revise",
      ),
      createElement(
        "button",
        {
          type: "button",
          "data-testid": testId(TID_WORKFLOW_CARD_RUN, entry.name),
          onClick: () => onRun(entry),
        },
        "run",
      ),
      onMove
        ? createElement(
            "button",
            {
              type: "button",
              "data-testid": testId(TID_WORKFLOW_ACTION_MOVE, entry.name),
              onClick: () => onMove(entry),
            },
            "move",
          )
        : null,
      createElement(
        "button",
        {
          type: "button",
          "data-testid": testId(TID_WORKFLOW_ACTION_DELETE, entry.name),
          onClick: () => onDelete(entry),
        },
        "delete",
      ),
    ),
}));
vi.mock("@/settings/saved-workflows/SavedWorkflowDetailView.js", () => ({
  SavedWorkflowDetailView: ({
    name,
    projectLabel,
    onBack,
  }: {
    name: string;
    projectLabel: string;
    onBack: () => void;
  }) =>
    createElement(
      "div",
      { "data-testid": TID_WORKFLOW_DETAIL, "data-name": name, "data-project": projectLabel },
      createElement("button", { type: "button", onClick: onBack }, "back"),
    ),
}));

const { SavedWorkflowProjectGroup } =
  await import("@/settings/saved-workflows/SavedWorkflowProjectGroup.js");

function entry(
  name: string,
  overrides: Partial<CfSavedWorkflowEntry> = {},
): CfSavedWorkflowEntry {
  return {
    name,
    description: `${name} 的Description`,
    scope: "project",
    path: `/beta/.cf/workflows/${name}.dwf.ts`,
    ...overrides,
  };
}

const BETA: AutomationWorkspaceOption = { workspacePath: "/beta", label: "Beta" };

function mount(props: Partial<Parameters<typeof SavedWorkflowProjectGroup>[0]> = {}) {
  const onNavigateToLaunchedRun = vi.fn();
  const onCreateViaChat = vi.fn();
  const onOpenWorkflowRun = vi.fn();
  const onStateChange = vi.fn();
  const onOpenDetail = vi.fn();
  const onBack = vi.fn();
  const result = render(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(SavedWorkflowProjectGroup, {
        project: BETA,
        isCurrent: false,
        refreshSeq: 0,
        mode: { kind: "list" },
        onStateChange,
        onOpenDetail,
        onBack,
        onNavigateToLaunchedRun,
        onCreateViaChat,
        onOpenWorkflowRun,
        ...props,
      }),
    ),
  );
  return {
    ...result,
    onNavigateToLaunchedRun,
    onCreateViaChat,
    onOpenWorkflowRun,
    onStateChange,
    onOpenDetail,
    onBack,
  };
}

describe("SavedWorkflowProjectGroup", () => {
  beforeEach(() => {
    resetSavedWorkflowStoreForTests();
    agentBeta.listResult.current = { workflows: [], invalid: [], dir: "/beta/.cf/workflows" };
    agentBeta.runsResult.current = [];
    agentRepo.listResult.current = { workflows: [], invalid: [], dir: "/repo/.cf/workflows" };
    agentRepo.runsResult.current = [];
    changeListener = null;
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
  });
  afterEach(() => {
    cleanup();
  });

  it("用 ITS project 的 agent 拉取，渲染卡片与上次Run归组；无实参「Run」直接发From并带本Project target", async () => {
    agentBeta.listResult.current = {
      workflows: [entry("release-check"), entry("nightly")],
      invalid: [],
    };
    agentBeta.runsResult.current = [
      {
        runId: "r-old",
        name: "release-check",
        status: "failed",
        createdAt: 1,
        updatedAt: 2,
        spentTokens: 0,
      },
      {
        runId: "r-new",
        name: "release-check",
        status: "completed",
        createdAt: 3,
        updatedAt: 9,
        spentTokens: 0,
      },
    ];
    mount();
    await screen.findByTestId(testId(TID_WORKFLOWS_LIST, "/beta"));
    expect(agentBeta.listSavedWorkflows).toHaveBeenCalledWith({ workspacePath: "/beta" });
    expect(agentRepo.listSavedWorkflows).not.toHaveBeenCalled();
    expect(agentBeta.listSavedWorkflowRuns).toHaveBeenCalledWith({
      workspacePath: "/beta",
      limit: 50,
    });
    expect(
      screen.getByTestId(testId(TID_WORKFLOW_CARD, "release-check")).getAttribute("data-last-run"),
    ).toBe("r-new");
    expect(
      screen.getByTestId(testId(TID_WORKFLOW_CARD, "nightly")).getAttribute("data-last-run"),
    ).toBe("");

    fireEvent.click(screen.getByTestId(testId(TID_WORKFLOW_CARD_RUN, "nightly")));
    await waitFor(() => expect(launchMock).toHaveBeenCalledTimes(1));
    expect(launchMock.mock.calls[0]?.[0]).toEqual({ workspacePath: "/beta" });
    expect(launchMock.mock.calls[0]?.[1]).toEqual({ name: "nightly", scope: "project", args: {} });
  });

  it("回报加载态To页：加载Completed且有Workflow → { loaded:true, empty:false }", async () => {
    agentBeta.listResult.current = { workflows: [entry("a")], invalid: [] };
    const { onStateChange } = mount();
    await screen.findByTestId(testId(TID_WORKFLOW_CARD, "a"));
    await waitFor(() =>
      expect(onStateChange).toHaveBeenLastCalledWith("/beta", {
        loaded: true,
        empty: false,
        count: 1,
      }),
    );
  });

  it("空组：加载Completed且无Workflow无坏File时渲染 null，但仍回报 { loaded:true, empty:true }", async () => {
    const { onStateChange, container } = mount();
    await waitFor(() =>
      expect(onStateChange).toHaveBeenLastCalledWith("/beta", {
        loaded: true,
        empty: true,
        count: 0,
      }),
    );
    expect(
      container.querySelector(`[data-testid="${testId(TID_WORKFLOW_PROJECT_GROUP, "/beta")}"]`),
    ).toBeNull();
  });

  it("Bad file row lists path and reason; group still appears", async () => {
    agentBeta.listResult.current = {
      workflows: [entry("ok")],
      invalid: [{ path: "/beta/.cf/workflows/bad.dwf.ts", reason: "invalid_yaml" }],
    };
    const { container } = mount();
    await screen.findByTestId(testId(TID_WORKFLOW_CARD, "ok"));
    const strip = container.querySelector('[data-workflows-invalid="true"]');
    expect(strip?.textContent).toContain("1 个文件无法读取");
    expect(strip?.textContent).toContain("/beta/.cf/workflows/bad.dwf.ts");
  });

  it("Bypass cache and refetch when refreshSeq changes; debounced refresh on directory change; remove listeners on unmount", async () => {
    agentBeta.listResult.current = { workflows: [entry("a")], invalid: [] };
    const { rerender } = mount();
    await screen.findByTestId(testId(TID_WORKFLOW_CARD, "a"));
    expect(agentBeta.listSavedWorkflows).toHaveBeenCalledTimes(1);

    rerender(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(SavedWorkflowProjectGroup, {
          project: BETA,
          isCurrent: false,
          refreshSeq: 1,
          mode: { kind: "list" },
          onStateChange: vi.fn(),
          onOpenDetail: vi.fn(),
          onBack: vi.fn(),
          onNavigateToLaunchedRun: vi.fn(),
          onCreateViaChat: vi.fn(),
          onOpenWorkflowRun: vi.fn(),
        }),
      ),
    );
    await waitFor(() => expect(agentBeta.listSavedWorkflows).toHaveBeenCalledTimes(2));

    expect(fileWatcherService.watch).toHaveBeenCalledWith({ path: "/beta/.cf/workflows" });
    await waitFor(() => expect(changeListener).not.toBeNull());
    changeListener?.();
    await waitFor(() => expect(agentBeta.listSavedWorkflows).toHaveBeenCalledTimes(3), {
      timeout: 2000,
    });
    cleanup();
    expect(watcherDispose).toHaveBeenCalled();
    expect(fileWatcherService.unwatch).toHaveBeenCalledWith({ id: "watch-1" });
  });

  it("Delete: Call delete with current project target after confirmation and refresh; do nothing if cancelled", async () => {
    agentBeta.listResult.current = { workflows: [entry("x")], invalid: [] };
    mount();
    await screen.findByTestId(testId(TID_WORKFLOW_CARD, "x"));
    confirmMock.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByTestId(testId(TID_WORKFLOW_ACTION_DELETE, "x")));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(agentBeta.deleteSavedWorkflow).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId(testId(TID_WORKFLOW_ACTION_DELETE, "x")));
    await waitFor(() =>
      expect(agentBeta.deleteSavedWorkflow).toHaveBeenCalledWith({
        workspacePath: "/beta",
        name: "x",
      }),
    );
    expect(agentRepo.deleteSavedWorkflow).not.toHaveBeenCalled();
    await waitFor(() => expect(agentBeta.listSavedWorkflows).toHaveBeenCalledTimes(2));
    expect(toastMock).toHaveBeenCalledWith("Deleted workflow \"x\"");
  });

  it("Revise: Prefill draft with current project target", async () => {
    agentBeta.listResult.current = { workflows: [entry("x")], invalid: [] };
    const { onCreateViaChat } = mount();
    await screen.findByTestId(testId(TID_WORKFLOW_CARD, "x"));
    fireEvent.click(screen.getByTestId("revise-x"));
    expect(onCreateViaChat).toHaveBeenCalledTimes(1);
    expect(onCreateViaChat.mock.calls[0]?.[0]).toContain("Please revise saved workflow \"x\"");
    expect(onCreateViaChat.mock.calls[0]?.[1]).toEqual({ workspacePath: "/beta" });
  });

  it("Group header \"Create via Chat\" includes test ID with workspaceKey and current project target", async () => {
    agentBeta.listResult.current = { workflows: [entry("x")], invalid: [] };
    const { onCreateViaChat } = mount();
    await screen.findByTestId(testId(TID_WORKFLOW_CARD, "x"));
    fireEvent.click(screen.getByTestId(testId(TID_WORKFLOWS_CREATE_VIA_CHAT, "/beta")));
    expect(onCreateViaChat.mock.calls[0]?.[1]).toEqual({ workspacePath: "/beta" });
    expect(onCreateViaChat.mock.calls[0]?.[0]).toContain("帮我设计一个工作流");
  });

  it("Promote to global: Call promote with current project target and name / path / locale; do not call move or toast", async () => {
    agentBeta.listResult.current = {
      workflows: [entry("x")],
      invalid: [],
      dir: "/beta/.cf/workflows",
    };
    mount();
    await screen.findByTestId(testId(TID_WORKFLOW_CARD, "x"));
    fireEvent.click(screen.getByTestId(testId(TID_WORKFLOW_ACTION_MOVE, "x")));
    await waitFor(() => expect(promoteMock).toHaveBeenCalledTimes(1));
    expect(promoteMock.mock.calls[0]?.[0]).toEqual({ workspacePath: "/beta" });
    expect(promoteMock.mock.calls[0]?.[1]).toEqual({
      name: "x",
      path: "/beta/.cf/workflows/x.dwf.ts",
      locale: "zh-CN",
    });
    expect(toastMock).not.toHaveBeenCalled();
    expect(agentBeta.listSavedWorkflows).toHaveBeenCalledTimes(1);
  });

  it("Promote to global: createSession rejected → toast promotion failure (with server reason)", async () => {
    agentBeta.listResult.current = {
      workflows: [entry("x")],
      invalid: [],
      dir: "/beta/.cf/workflows",
    };
    promoteMock.mockResolvedValueOnce({
      ok: false,
      code: "fault.command.workspaceReadOnly",
      message: "workspace is read-only",
    } as never);
    mount();
    await screen.findByTestId(testId(TID_WORKFLOW_CARD, "x"));
    fireEvent.click(screen.getByTestId(testId(TID_WORKFLOW_ACTION_MOVE, "x")));
    await waitFor(() => expect(promoteMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith("提升失败：workspace is read-only"));
  });

  it("Remote projects do not offer \"Promote to Global\" (Invariant 4: remote home does not enter hub)", async () => {
    agentBeta.listResult.current = {
      workflows: [entry("x")],
      invalid: [],
      dir: "/beta/.cf/workflows",
    };
    mount({ project: { ...BETA, remoteSessionId: "remote-1" } });
    await screen.findByTestId(testId(TID_WORKFLOW_CARD, "x"));
    expect(screen.queryByTestId(testId(TID_WORKFLOW_ACTION_MOVE, "x"))).toBeNull();
  });

  it("Clicking a card to view details is determined by the page: onOpenDetail carries the workflow name", async () => {
    agentBeta.listResult.current = { workflows: [entry("x")], invalid: [] };
    const { onOpenDetail } = mount();
    await screen.findByTestId(testId(TID_WORKFLOW_CARD, "x"));
    fireEvent.click(screen.getByText("open"));
    expect(onOpenDetail).toHaveBeenCalledWith("x");
  });

  it("detail mode renders SavedWorkflowDetailView and passes project name to detail page", async () => {
    agentBeta.listResult.current = { workflows: [entry("x")], invalid: [] };
    const { onBack } = mount({ mode: { kind: "detail", name: "x" } });
    const detail = await screen.findByTestId(TID_WORKFLOW_DETAIL);
    expect(detail.getAttribute("data-name")).toBe("x");
    expect(detail.getAttribute("data-project")).toBe("Beta");
    fireEvent.click(screen.getByText("back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
