// @vitest-environment jsdom

//
//
import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TID_CHAT_WORKFLOW_ARTIFACT_CHIP } from "@origin-ai/cf-shared";
import type { IPlatformService } from "@origin-ai/cf-shared";
import type { AssistantTextRow, TurnHeaderRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowNotificationMeta } from "@origin-ai/cf-shared/cf-protocol-v4";

vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServices: () => ({}),
}));

import { CfIntlProvider } from "@/i18n/IntlProvider.js";
// eslint-disable-next-line import/first
import { TooltipProvider } from "@/components/ui/tooltip.js";
// eslint-disable-next-line import/first
import { PlatformProvider } from "@/hooks/usePlatform.js";
// eslint-disable-next-line import/first
import { WorkflowNotificationToolRow } from "@/v4/WorkflowNotificationToolRow.js";
// eslint-disable-next-line import/first
import { ConversationTurnGroup } from "@/v4/ConversationTurnGroup.js";
// eslint-disable-next-line import/first
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
// eslint-disable-next-line import/first
import { buildConversationTurnRenderUnits } from "@/v4/conversationTurnRenderUnits.js";

const onOpenArtifact = vi.fn();

function terminal(
  artifacts: NonNullable<Extract<WorkflowNotificationMeta, { kind: "terminal" }>["artifacts"]>,
): WorkflowNotificationMeta {
  return {
    kind: "terminal",
    status: "completed",
    summary: "Workflow run completed.",
    durationMs: 1000,
    result: "done",
    resultForm: "prose",
    artifacts,
  };
}

let rowSeq = 0;

function renderRow(notification: WorkflowNotificationMeta, options: { openable?: boolean } = {}) {
  rowSeq += 1;
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(
        TooltipProvider,
        null,
        createElement(WorkflowNotificationToolRow, {
          notification,
          runName: "flaky-test-triage",
          testIdKey: `unit-${rowSeq}`,
          theme: "system",
          ...(options.openable === false ? {} : { onOpenArtifact }),
        }),
      ),
    ),
  );
}

beforeEach(() => {
  cleanup();
  onOpenArtifact.mockClear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

describe("通知行的产物 chips", () => {
  it("点 chip 把产物 id 交To宿主", () => {
    const view = renderRow(
      terminal([
        { id: "book", kind: "file", title: "审计报告", version: 2 },
        { id: "perf", kind: "chart", title: "每轮耗时", version: 1 },
      ]),
    );
    const chips = view.getAllByTestId(TID_CHAT_WORKFLOW_ARTIFACT_CHIP);
    expect(chips).toHaveLength(2);

    fireEvent.click(chips[1]!);
    expect(onOpenArtifact).toHaveBeenCalledWith("perf");
  });

  it("点 chip 不顺带把通知行展开——头部整条Yes折叠开关，chip 的点击必须止步于自己", () => {
    const view = renderRow(terminal([{ id: "book", kind: "file", version: 1 }]));
    const trigger = view.container.querySelector("[aria-expanded]");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(view.getByTestId(TID_CHAT_WORKFLOW_ARTIFACT_CHIP));
    expect(onOpenArtifact).toHaveBeenCalledWith("book");
    expect(view.container.querySelector("[aria-expanded]")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("title 缺席时 chip Returned id（facade 的缺省 title 本来就Yes id）", () => {
    const view = renderRow(terminal([{ id: "book", kind: "file", version: 1 }]));
    expect(view.getByTestId(TID_CHAT_WORKFLOW_ARTIFACT_CHIP).textContent).toContain("book");
  });

  it("LongTitle在 chip 上截断，hover Notice里仍YesComplete的 kind 词 + Title", () => {
    const long = "This isOne个非常非常非常Long的产物Title，Long到必须在 chip 上被截断掉One部分才摆得下";
    const view = renderRow(terminal([{ id: "book", kind: "file", title: long, version: 1 }]));
    const chip = view.getByTestId(TID_CHAT_WORKFLOW_ARTIFACT_CHIP);
    expect(chip.textContent?.endsWith("…")).toBe(true);
    expect(chip.getAttribute("title")).toBe(`File · ${long}`);
  });

  it("宿主没注入打开Capabilities时 chip 不可点，点了也什么都不发生", () => {
    const view = renderRow(terminal([{ id: "book", kind: "file", version: 1 }]), {
      openable: false,
    });
    const chip = view.getByTestId(TID_CHAT_WORKFLOW_ARTIFACT_CHIP);
    expect(chip.hasAttribute("disabled")).toBe(true);
    fireEvent.click(chip);
    expect(onOpenArtifact).not.toHaveBeenCalled();
  });

  it("点**禁用的** chip 同样不展开行：禁用只Yes把打开变成空操作，不Yes把 chip 交还To开关", () => {
    const view = renderRow(terminal([{ id: "book", kind: "file", version: 1 }]), {
      openable: false,
    });
    expect(view.container.querySelector("[aria-expanded]")?.getAttribute("aria-expanded")).toBe(
      "false",
    );

    fireEvent.click(view.getByTestId(TID_CHAT_WORKFLOW_ARTIFACT_CHIP));

    expect(view.container.querySelector("[aria-expanded]")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(view.queryByTestId("workflow-notification-artifacts")).toBeTruthy();
    expect(onOpenArtifact).not.toHaveBeenCalled();
  });

  it("在 chip 上按 Enter 只打开产物，不顺带把行展开（键盘走的Yes开关的另One条通路）", () => {
    const view = renderRow(terminal([{ id: "book", kind: "file", version: 1 }]));
    fireEvent.keyDown(view.getByTestId(TID_CHAT_WORKFLOW_ARTIFACT_CHIP), { key: "Enter" });
    expect(view.container.querySelector("[aria-expanded]")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("展开之后 chips Collapse——展开体自己在说Result，chips 再挂着只Yes重复", () => {
    const view = renderRow(terminal([{ id: "book", kind: "file", version: 1 }]));
    expect(view.queryByTestId("workflow-notification-artifacts")).toBeTruthy();

    fireEvent.click(view.container.querySelector("[aria-expanded]")!);
    expect(view.queryByTestId("workflow-notification-artifacts")).toBeNull();
  });
});

describe("ConversationTurnGroup 把通知行的 chip 变成打开Request", () => {
  const noopPlatform = {} as IPlatformService;

  function notificationUnit(
    artifacts: NonNullable<Extract<WorkflowNotificationMeta, { kind: "terminal" }>["artifacts"]>,
  ) {
    const header: TurnHeaderRow = {
      rowId: 1,
      turnId: "turn-1",
      createdAt: 1_700_000_000_000,
      createdAtSeq: 1,
      kind: "turnHeader",
      origin: "backgroundResult",
      state: "completedSuccess",
      startedAt: 1_700_000_000_000,
      originMeta: {
        backgroundSource: "workflow",
        title: "flaky-test-triage",
        workId: "run-abc",
        workflowNotification: {
          kind: "terminal",
          status: "completed",
          summary: "Workflow run completed.",
          durationMs: 1000,
          artifacts,
        },
      },
    };
    const text: AssistantTextRow = {
      rowId: 2,
      entityId: "message-assistant-2",
      turnId: "turn-1",
      createdAt: 1_700_000_000_002,
      createdAtSeq: 2,
      kind: "assistantText",
      state: "complete",
      text: "BackgroundSummaryFinal段",
    };
    return buildConversationTurnRenderUnits([header, text])[0]!;
  }

  function renderTurn(
    artifacts: NonNullable<Extract<WorkflowNotificationMeta, { kind: "terminal" }>["artifacts"]>,
    onOpenWorkflowArtifact: (request: unknown) => void,
  ) {
    return render(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(
          PlatformProvider,
          { platform: noopPlatform },
          createElement(
            TooltipProvider,
            null,
            createElement(ConversationTurnGroup, {
              unit: notificationUnit(artifacts),
              context: {
                workspacePath: "/workspace",
                theme: "system",
                sessionId: "parent-a",
                onOpenWorkflowArtifact,
              } as unknown as ConversationRowRenderContext,
            }),
          ),
        ),
      ),
    );
  }

  it("带上载荷里那One枚的 contentType（html 产物据它直接开Browser tab）", () => {
    const spy = vi.fn();
    const view = renderTurn(
      [
        { id: "book", kind: "file", title: "审计报告", version: 2, contentType: "text/html" },
        { id: "perf", kind: "chart", title: "每轮耗时", version: 1 },
      ],
      spy,
    );

    fireEvent.click(view.getAllByTestId(TID_CHAT_WORKFLOW_ARTIFACT_CHIP)[0]!);
    expect(spy).toHaveBeenCalledWith({
      parentSessionId: "parent-a",
      runId: "run-abc",
      artifactId: "book",
      contentType: "text/html",
    });
  });

  it("载荷上没有 contentType 的那One枚不编One个出来", () => {
    const spy = vi.fn();
    const view = renderTurn([{ id: "perf", kind: "chart", title: "每轮耗时", version: 1 }], spy);

    fireEvent.click(view.getByTestId(TID_CHAT_WORKFLOW_ARTIFACT_CHIP));
    expect(spy).toHaveBeenCalledWith({
      parentSessionId: "parent-a",
      runId: "run-abc",
      artifactId: "perf",
    });
  });
});
