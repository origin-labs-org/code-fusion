// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StepRunStatus } from "@/components/workflow-graph/types.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import {
  rosterCounts,
  rosterMore,
  rosterRestCounts,
  stationRoster,
} from "@/components/workflow-timeline/roster-model.js";
import type { TimelinePill } from "@/components/workflow-timeline/timeline-model.js";
import { WorkflowMoreRow } from "@/components/workflow-timeline/WorkflowMoreRow.js";

afterEach(() => {
  cleanup();
});

function pill(index: number, status: StepRunStatus | undefined): TimelinePill {
  return {
    key: `phase#a:actor#1@${index}`,
    avatarIndex: index,
    lane: { id: "actor#1", laneClass: "agent" },
    laneClass: "agent",
    runtimeName: `review-${index}`,
    status,
    instance: { ordinal: index, siteId: "actor#1", sessionId: `s-${index}` },
    slot: { ordinal: index, siteId: "actor#1" },
    stepIds: ["ask#1"],
  };
}
const pills = (statuses: readonly StepRunStatus[]) =>
  statuses.map((status, index) => pill(index + 1, status));

function renderRow(
  props: Parameters<typeof WorkflowMoreRow>[0],
  locale: "en-US" | "zh-CN" = "en-US",
) {
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(WorkflowMoreRow, props),
    ),
  );
}
const faceStates = (view: ReturnType<typeof renderRow>) =>
  [...view.getByTestId("workflow-more-deck").querySelectorAll("[data-face-state]")].map((face) =>
    face.getAttribute("data-face-state"),
  );

const STATUSES: StepRunStatus[] = [
  "done",
  "done",
  "running",
  "failed",
  "done",
  "running",
  "pending",
  "done",
  "done",
];

describe("WorkflowMoreRow", () => {
  it("有回调Yes按钮、整行One个 title；Three张脸按注意力序、表情带Status；↗ 常驻；点One下回调", () => {
    const onOpen = vi.fn();
    const more = rosterMore(stationRoster(pills(STATUSES), { pins: 5 })!);
    const view = renderRow({ enterDelayMs: 150, more, onOpen });
    const row = view.getByTestId("workflow-roster-more-row");
    expect(row.tagName).toBe("BUTTON");
    expect(row.getAttribute("type")).toBe("button");
    expect(row.getAttribute("data-more-count")).toBe("4");
    expect(row.textContent).toBe("4 more");
    expect(row.getAttribute("title")).toBe("4 more subagents · list everyone in the run pane");
    expect(row.getAttribute("aria-label")).toBe(row.getAttribute("title"));
    expect(row.className).toContain("wf-pill-open");
    expect(row.style.animationDelay).toBe("150ms");
    expect(faceStates(view)).toEqual(["waiting", "content", "content"]);
    const faces = view.getByTestId("workflow-more-deck").querySelectorAll("[data-face-state]");
    expect([...faces].every((face) => face.classList.contains("wf-more-face"))).toBe(true);
    expect(view.getByTestId("workflow-more-open").className).toContain("wf-pill-go-rest");
    expect(view.queryByTestId("workflow-more-failed")).toBeNull();
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("藏着Failed时One枚Red色 `✕ n`，Failed的脸排在叠的最前；没有回调时Yes静态的 span", () => {
    const list = pills([
      "failed",
      "failed",
      "failed",
      "failed",
      "failed",
      "failed",
      "done",
      "running",
    ]);
    const view = renderRow({ more: rosterMore(stationRoster(list, { pins: 5 })!) });
    const row = view.getByTestId("workflow-roster-more-row");
    expect(row.tagName).toBe("SPAN");
    expect(row.getAttribute("type")).toBeNull();
    expect(row.className).not.toContain("wf-pill-open");
    expect(row.getAttribute("data-more-count")).toBe("3");
    const failed = view.getByTestId("workflow-more-failed");
    expect(failed.textContent).toBe("2");
    expect(failed.getAttribute("title")).toBe("2 failed");
    expect(faceStates(view)).toEqual(["sad", "sad", "content"]);
  });

  it("zh-CN: \"n remaining\" and full sentence title", () => {
    const more = rosterMore(stationRoster(pills(STATUSES), { pins: 5 })!);
    const view = renderRow({ more, onOpen: vi.fn() }, "zh-CN");
    const row = view.getByTestId("workflow-roster-more-row");
    expect(row.textContent).toBe("还有 4 个");
    expect(row.getAttribute("title")).toBe("还有 4 个Sub-agent · 在RunSidebar里列出All");
  });

  it("门关着：尾槽Yes下箭头、aria-expanded=false、带其余人的计Count行（钉住的不算）、没有 ✕ n 徽记", () => {
    const list = pills([
      "running",
      "running",
      "running",
      "running",
      "running",
      "running",
      "failed",
      "done",
    ]);
    const roster = stationRoster(list, { pins: 5 })!;
    const onOpen = vi.fn();
    const view = renderRow({
      door: { open: false, tally: rosterCounts(roster.rest) },
      more: rosterMore(roster),
      onOpen,
    });
    const row = view.getByTestId("workflow-roster-more-row");
    expect(row.getAttribute("data-door")).toBe("closed");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.getAttribute("title")).toBe("3 more subagents · list them here");
    expect(row.getAttribute("aria-label")).toBe(row.getAttribute("title"));
    expect(row.className).toContain("bg-surface");
    expect(row.className).not.toContain("bg-surface-hover");
    expect(view.queryByTestId("workflow-more-open")).toBeNull();
    expect(view.getByTestId("workflow-more-chevron").className).not.toContain("rotate-180");
    const tally = view.getByTestId("workflow-roster-tally");
    const items = [...tally.querySelectorAll("[data-roster-count]")];
    expect(
      items.map((item) => `${item.getAttribute("data-roster-count")}:${item.textContent}`),
    ).toEqual(["done:1", "running:1", "failed:1"]);
    expect(view.queryByTestId("workflow-more-failed")).toBeNull();
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("门开着：计Count行走人、箭头转 180°、底色抬One级、名Character转前景、title 说Collapse；zh-CN 两种Copy", () => {
    const roster = stationRoster(pills(STATUSES), { pins: 5 })!;
    const view = renderRow({
      door: { open: true, tally: rosterCounts(roster.rest) },
      more: rosterMore(roster),
      onOpen: vi.fn(),
    });
    const row = view.getByTestId("workflow-roster-more-row");
    expect(row.getAttribute("data-door")).toBe("open");
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(row.getAttribute("title")).toBe("4 more subagents · fold");
    expect(row.className).toContain("bg-surface-hover");
    expect(view.queryByTestId("workflow-roster-tally")).toBeNull();
    expect(view.getByTestId("workflow-more-chevron").className).toContain("rotate-180");
    expect(row.querySelector(".wf-pill-name")!.className).toContain("text-foreground");
    expect(row.textContent).toBe("4 more");
    cleanup();

    const zh = renderRow(
      {
        door: { open: false, tally: rosterCounts(roster.rest) },
        more: rosterMore(roster),
        onOpen: vi.fn(),
      },
      "zh-CN",
    );
    expect(zh.getByTestId("workflow-roster-more-row").getAttribute("title")).toBe(
      "还有 4 个Sub-agent · 在这里列出",
    );
    cleanup();
    const zhOpen = renderRow(
      {
        door: { open: true, tally: rosterCounts(roster.rest) },
        more: rosterMore(roster),
        onOpen: vi.fn(),
      },
      "zh-CN",
    );
    expect(zhOpen.getByTestId("workflow-roster-more-row").getAttribute("title")).toBe(
      "还有 4 个Sub-agent · Collapse",
    );
  });

  it("被淘汰的Sub-agent也在这One行后面：人Count与Red ✕ 把它们算进来，叠上的脸只有表inner的", () => {
    const roster = stationRoster(
      pills(["running", "running", "running", "running", "running", "failed", "done"]),
      { pins: 5, unlisted: { actors: 10, failed: 3, settled: 10 } },
    )!;
    const view = renderRow({ more: rosterMore(roster) });
    const row = view.getByTestId("workflow-roster-more-row");
    expect(row.getAttribute("data-more-count")).toBe("12");
    expect(row.textContent).toBe("12 more4");
    expect(view.getByTestId("workflow-more-failed").textContent).toBe("4");
    expect(faceStates(view)).toEqual(["sad", "content"]);
    cleanup();

    const door = renderRow({
      door: { open: false, tally: rosterRestCounts(roster) },
      more: rosterMore(roster),
      onOpen: vi.fn(),
    });
    const items = [
      ...door.getByTestId("workflow-roster-tally").querySelectorAll("[data-roster-count]"),
    ];
    expect(
      items.map((item) => `${item.getAttribute("data-roster-count")}:${item.textContent}`),
    ).toEqual(["done:8", "failed:4"]);
  });
});
