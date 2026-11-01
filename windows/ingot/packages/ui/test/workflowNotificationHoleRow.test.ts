import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

vi.mock("@/components/ai-elements/code-block.js", () => ({
  CodeBlockHeader: () => null,
  CodeBlock: ({ code }: { code: string; children?: ReactNode }) =>
    createElement("pre", { "data-testid": "code-block" }, code),
}));

import {
  WorkflowNotificationToolRow,
  type WorkflowNotificationToolRowProps,
} from "@/v4/WorkflowNotificationToolRow.js";
import { holeRowState } from "@/v4/WorkflowNotificationHoleRow.js";

const HOLE = {
  kind: "hole" as const,
  siteId: "hole#1",
  ordinal: 1,
  name: "决定分组",
  type: "Plan",
  prompt: "Reconnaissance results are as follows，请Complete这One段。",
  draftPath: "/w/.cf/workflow-drafts/flaky.dwf.ts",
  line: 12,
  before: "探索",
  after: "执行",
  reachedAt: Date.now() - 3 * 60_000,
};

function render(
  props: Partial<WorkflowNotificationToolRowProps>,
  locale: "en-US" | "zh-CN" = "zh-CN",
): string {
  return renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(WorkflowNotificationToolRow, {
        notification: HOLE,
        runName: "flaky-hunt",
        testIdKey: "turn-1:1",
        theme: "system",
        ...props,
      } as WorkflowNotificationToolRowProps),
    ),
  );
}

describe("holeRowState", () => {
  it("run 不在场 → left；在场且 waiting → waiting；在场且 filled / 不在表里 → filled / left", () => {
    expect(holeRowState(undefined, "hole#1")).toBe("left");
    expect(
      holeRowState([{ siteId: "hole#1", ordinal: 1, name: "n", state: "waiting" }], "hole#1"),
    ).toBe("waiting");
    expect(
      holeRowState([{ siteId: "hole#1", ordinal: 1, name: "n", state: "filled" }], "hole#1"),
    ).toBe("filled");
    expect(holeRowState([], "hole#1")).toBe("left");
  });
});

describe("WorkflowNotificationToolRow — hole", () => {
  it("Three态种类词：Awaiting completion / Filled全 / Medium性", () => {
    const waiting = render({
      holes: [{ siteId: "hole#1", ordinal: 1, name: "决定分组", state: "waiting" }],
    });
    expect(waiting).toContain("Workflow hole · Awaiting completion");
    expect(waiting).toContain('data-hole-state="waiting"');
    expect(
      render({ holes: [{ siteId: "hole#1", ordinal: 1, name: "决定分组", state: "filled" }] }),
    ).toContain("Hole completed");
    expect(render({})).toContain("Workflow留白");
    expect(render({}, "en-US")).toContain("Workflow left a hole");
    expect(
      render(
        { holes: [{ siteId: "hole#1", ordinal: 1, name: "决定分组", state: "waiting" }] },
        "en-US",
      ),
    ).toContain("Workflow waiting for code");
  });

  it("主Text：run 名与留白名，不画类型；行永不 shimmer", () => {
    const html = render({});
    expect(html).toContain("flaky-hunt");
    expect(html).toContain('data-testid="workflow-hole-notification-name"');
    expect(html).toContain("决定分组");
    expect(html).not.toContain("workflow-hole-type");
    expect(html).not.toContain("Plan");
    expect(html).not.toContain("animate-pulse");
  });

  it("展开体：Notice全Text、位于两站之间、Draft路径:L 行、WaitingDuration、run 链接；不写须Back的类型", () => {
    const html = render({
      forceOpen: true,
      holes: [{ siteId: "hole#1", ordinal: 1, name: "决定分组", state: "waiting" }],
      onOpenRun: () => undefined,
    });
    expect(html).toContain("Reconnaissance results are as follows，请Complete这One段。");
    expect(html).toContain("留白位于「explore」之后、「execute」之前；");
    expect(html).not.toContain("Complete须Back");
    expect(html).not.toContain("Plan");
    expect(html).toContain("/w/.cf/workflow-drafts/flaky.dwf.ts:L12");
    expect(html).toContain('data-testid="workflow-hole-notification-waited"');
    expect(html).toContain("Waiting · 3 分钟前");
    expect(html).toContain("View InstanceDetails");
  });

  it("Filled全的行不写WaitingDuration；只有One侧邻站时换措辞", () => {
    const filled = render({
      forceOpen: true,
      notification: { ...HOLE, before: undefined, after: "执行" },
      holes: [{ siteId: "hole#1", ordinal: 1, name: "决定分组", state: "filled" }],
    });
    expect(filled).not.toContain('data-testid="workflow-hole-notification-waited"');
    expect(filled).toContain("留白位于「execute」之前；");
  });
});
