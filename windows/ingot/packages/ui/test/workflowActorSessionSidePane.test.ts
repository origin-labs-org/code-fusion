// @vitest-environment jsdom

//
//
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowActorSessionSidePaneTab } from "@/lib/workspaceSidePane.js";

const paneState = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  
  rendered: [] as string[],
}));

const leaseState = vi.hoisted(() => ({
  
  acquired: [] as string[],
  release: vi.fn(),
}));
const conversation = vi.hoisted(() => ({
  layer: {
    acquire: (sessionId: string) => {
      leaseState.acquired.push(sessionId);
      return { release: leaseState.release };
    },
  },
}));

vi.mock("@/v4/SessionPane.js", async () => {
  const React = await import("react");
  return {
    SessionPane: (props: Record<string, unknown>) => {
      paneState.props = props;
      paneState.rendered.push(String(props.sessionId));
      React.useEffect(() => {
        const lease = conversation.layer.acquire(String(props.sessionId));
        return () => lease.release();
      }, [props.sessionId]);
      return React.createElement("div", { "data-testid": "mock-session-pane" });
    },
  };
});

const scopeState = vi.hoisted(() => ({ scope: null as unknown }));

vi.mock("@/v4/V4ConversationContext.js", async () => {
  const React = await import("react");
  return {
    V4PaneConversationProvider: ({ children, scope }: { children?: ReactNode; scope: unknown }) => {
      scopeState.scope = scope;
      return React.createElement(React.Fragment, null, children);
    },
    useV4Conversation: () => conversation,
  };
});

const projectionState = vi.hoisted(() => ({ snapshot: null as unknown }));

vi.mock("@/v4/useConversationProjection.js", () => ({
  useConversationProjection: (lease: unknown) =>
    lease === null || lease === undefined
      ? { snapshot: undefined }
      : { snapshot: projectionState.snapshot },
}));

import { cleanup, render } from "@testing-library/react";
// eslint-disable-next-line import/first
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
// eslint-disable-next-line import/first
import { WorkflowActorSessionSidePane } from "@/app-shell/WorkflowActorSessionSidePane.js";
// eslint-disable-next-line import/first
import { openWorkflowActorSessionSidePane } from "@/lib/workspaceSidePane.js";

const ACTOR_SESSION_ID = "dwf-dwfrun-1-actor_1@2";

function tabOf(overrides: Partial<WorkflowActorSessionSidePaneTab> = {}) {
  const state = openWorkflowActorSessionSidePane(null, {
    workspaceKey: "ssh://host/workspace",
    workspacePath: "/workspace",
    workspaceIdentity: "ssh://host/workspace",
    remoteSessionId: "remote-1",
    parentSessionId: "parent-a",
    runId: "dwfrun-1",
    actorSessionId: ACTOR_SESSION_ID,
    siteId: "actor#1",
    ordinal: 2,
    actorName: "reviewer",
  });
  const tab = state.tabs[0] as WorkflowActorSessionSidePaneTab;
  return { ...tab, ...overrides };
}

function snapshotWith(
  nodes: WorkflowRunState["nodes"],
  sessionId = ACTOR_SESSION_ID,
  actors: WorkflowRunState["actors"] = [
    { siteId: "actor#1", ordinal: 2, name: "reviewer", sessionId, status: "waiting" },
  ],
) {
  return {
    rows: { window: [] },
    workflowRuns: {
      revision: 1,
      runs: [
        {
          runId: "dwfrun-1",
          status: "running" as const,
          usage: { spentTokens: 0, nodesUsed: 0 },
          actors,
          nodes,
          lastEventSequence: 1,
        },
      ],
    },
  };
}

function renderTab(tab: WorkflowActorSessionSidePaneTab, locale: "en-US" | "zh-CN" = "en-US") {
  return createElement(
    CfIntlProvider,
    { initialLocale: locale },
    createElement(WorkflowActorSessionSidePane, { tab, focused: true }),
  );
}

function renderPane(locale: "en-US" | "zh-CN" = "en-US") {
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(WorkflowActorSessionSidePane, { tab: tabOf(), focused: true }),
    ),
  );
}

describe("WorkflowActorSessionSidePane", () => {
  afterEach(() => {
    cleanup();
    paneState.props = null;
    paneState.rendered = [];
    scopeState.scope = null;
    projectionState.snapshot = null;
    leaseState.acquired = [];
    leaseState.release.mockClear();
  });

  it("把 actor Session喂ToOne个只读的嵌套 SessionPane", () => {
    renderToStaticMarkup(
      createElement(WorkflowActorSessionSidePane, { tab: tabOf(), focused: true }),
    );

    expect(paneState.props).toMatchObject({
      allowWorkspaceFileRewind: true,
      focused: true,
      paneId: tabOf().id,
      readOnly: true,
      sessionId: "dwf-dwfrun-1-actor_1@2",
      telemetryVisible: true,
      workspacePath: "/workspace",
    });
  });

  it("不下发 subagent 下钻回调：actor 的Tools面里没有 subagent", () => {
    renderToStaticMarkup(
      createElement(WorkflowActorSessionSidePane, { tab: tabOf(), focused: false }),
    );

    expect(paneState.props?.onOpenSubagentSession).toBeUndefined();
    expect(paneState.props?.rootSessionId).toBeUndefined();
  });

  it("workspace scope 从 tab 上原样传To pane provider（Remote同路径Workspace不串台）", () => {
    renderToStaticMarkup(
      createElement(WorkflowActorSessionSidePane, { tab: tabOf(), focused: false }),
    );

    expect(scopeState.scope).toEqual({
      workspacePath: "/workspace",
      workspaceIdentity: "ssh://host/workspace",
      remoteSessionId: "remote-1",
    });
  });

  it("非 focused 时不上报前台 telemetry", () => {
    renderToStaticMarkup(
      createElement(WorkflowActorSessionSidePane, { tab: tabOf(), focused: false }),
    );

    expect(paneState.props).toMatchObject({ focused: false, telemetryVisible: false });
  });
});

describe("WorkflowActorSessionSidePane 未Start门", () => {
  afterEach(() => {
    cleanup();
    paneState.props = null;
    paneState.rendered = [];
    scopeState.scope = null;
    projectionState.snapshot = null;
    leaseState.acquired = [];
    leaseState.release.mockClear();
  });

  it("actor 尚未派发任何节点时渲染占位，且**不挂订阅**", () => {
    projectionState.snapshot = snapshotWith([
      { siteId: "ask#1", ordinal: 1, phase: "queued", actorSiteId: "actor#1", actorOrdinal: 2 },
    ]);
    const view = renderPane();

    expect(view.queryByTestId("workflow-actor-not-started")).not.toBeNull();
    expect(leaseState.acquired).not.toContain(ACTOR_SESSION_ID);
    expect(leaseState.acquired).toContain("parent-a");
    expect(paneState.rendered).toEqual([]);
    expect(view.queryByTestId("mock-session-pane")).toBeNull();
    expect(paneState.props).toBeNull();
  });

  it("占位Copy双语可读", () => {
    projectionState.snapshot = snapshotWith([]);

    const en = renderPane("en-US");
    expect(en.getByTestId("workflow-actor-not-started").textContent).toContain("Not started yet");
    cleanup();

    const zh = renderPane("zh-CN");
    expect(zh.getByTestId("workflow-actor-not-started").textContent).toContain("尚未Start");
  });

  it("投影抬升到 dispatched 后Auto换成嵌套 SessionPane（自愈，无需 retry）", () => {
    projectionState.snapshot = snapshotWith([]);
    const view = renderPane();
    expect(view.queryByTestId("workflow-actor-not-started")).not.toBeNull();

    projectionState.snapshot = snapshotWith([
      { siteId: "ask#1", ordinal: 1, phase: "dispatched", actorSiteId: "actor#1", actorOrdinal: 2 },
    ]);
    view.rerender(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(WorkflowActorSessionSidePane, { tab: tabOf(), focused: true }),
      ),
    );

    expect(view.queryByTestId("workflow-actor-not-started")).toBeNull();
    expect(view.queryByTestId("mock-session-pane")).not.toBeNull();
    expect(paneState.props).toMatchObject({ sessionId: ACTOR_SESSION_ID, readOnly: true });
    expect(leaseState.acquired).toContain(ACTOR_SESSION_ID);
  });

  it("started 与 unknown 都照Old订阅：投影里查不到这个 actor 时绝不拦", () => {
    projectionState.snapshot = snapshotWith([], ACTOR_SESSION_ID, []);
    const unknown = renderPane();
    expect(unknown.queryByTestId("mock-session-pane")).not.toBeNull();
    expect(unknown.queryByTestId("workflow-actor-not-started")).toBeNull();
    expect(leaseState.acquired).toContain(ACTOR_SESSION_ID);
    cleanup();
    leaseState.acquired = [];

    projectionState.snapshot = null;
    const empty = renderPane();
    expect(empty.queryByTestId("mock-session-pane")).not.toBeNull();
    expect(leaseState.acquired).toContain(ACTOR_SESSION_ID);
  });

  it("未Start药丸开的槽位 tab（没有Session id）：占位、不订阅；actor 带着Session出现并派发后自愈", () => {
    const { actorSessionId: _absent, ...slotTab } = tabOf();
    projectionState.snapshot = snapshotWith([], ACTOR_SESSION_ID, []);
    const view = render(renderTab(slotTab));
    expect(view.queryByTestId("workflow-actor-not-started")).not.toBeNull();
    expect(leaseState.acquired).toContain("parent-a");
    expect(leaseState.acquired).not.toContain(ACTOR_SESSION_ID);
    expect(paneState.rendered).toEqual([]);

    projectionState.snapshot = snapshotWith([]);
    view.rerender(renderTab({ ...slotTab }));
    expect(view.queryByTestId("workflow-actor-not-started")).not.toBeNull();
    expect(paneState.rendered).toEqual([]);

    projectionState.snapshot = snapshotWith([
      { siteId: "ask#1", ordinal: 1, phase: "dispatched", actorSiteId: "actor#1", actorOrdinal: 2 },
    ]);
    view.rerender(renderTab({ ...slotTab }));
    expect(view.queryByTestId("workflow-actor-not-started")).toBeNull();
    expect(paneState.props).toMatchObject({ sessionId: ACTOR_SESSION_ID, readOnly: true });
    expect(leaseState.acquired).toContain(ACTOR_SESSION_ID);
  });

  it("started 时订阅的Yes actor Session本身，不Yes父Session的替身", () => {
    projectionState.snapshot = snapshotWith([
      {
        siteId: "ask#1",
        ordinal: 1,
        phase: "settled",
        outcome: "ok",
        actorSiteId: "actor#1",
        actorOrdinal: 2,
      },
    ]);
    renderPane();

    expect(new Set(paneState.rendered)).toEqual(new Set([ACTOR_SESSION_ID]));
    expect(leaseState.acquired).toContain(ACTOR_SESSION_ID);
  });
});
