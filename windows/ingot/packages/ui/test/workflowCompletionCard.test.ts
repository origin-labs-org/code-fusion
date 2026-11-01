// @vitest-environment jsdom

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children?: ReactNode }) => children,
}));

import {
  COMPLETION_INDEX_MAX,
  WorkflowCompletionCard,
  formatCompactCount,
  type WorkflowCompletionCardProps,
} from "@/components/workflow-timeline/WorkflowCompletionCard.js";
import type { WorkflowCompletionArtifact } from "@/components/workflow-timeline/WorkflowArtifactTile.js";
import { formatWorkDuration, workDurationParts } from "@/lib/workDuration.js";

afterEach(() => {
  cleanup();
});

const ARTIFACTS: WorkflowCompletionArtifact[] = [
  { id: "brief", kind: "markdown", title: "research-brief.md", version: 1, bytes: 12_288 },
  {
    id: "sources",
    kind: "file",
    title: "sources.csv",
    version: 2,
    bytes: 6_144,
    contentType: "text/csv",
    sourcePath: "out/sources.csv",
  },
  { id: "coverage", kind: "chart", title: "source coverage", version: 1, itemCount: 4 },
];

function renderCard(
  overrides: Partial<WorkflowCompletionCardProps> = {},
  locale: "en-US" | "zh-CN" = "en-US",
) {
  const props: WorkflowCompletionCardProps = {
    name: "deep-research",
    figures: { durationMs: 708_000, tokens: 386_412, subagents: 10, phases: 16 },
    artifacts: ARTIFACTS,
    testIdKey: "turn-1",
    ...overrides,
  };
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(WorkflowCompletionCard, props),
    ),
  );
}

describe("WorkflowCompletionCard · 形态", () => {
  it("表头 = Completed的种类词 + 名Character + 灯与Status词；没有 chevron；有回调才有 ⤢", () => {
    const onOpenRun = vi.fn();
    const view = renderCard({ onOpenRun });
    const card = view.getByTestId("workflow-completion-card-turn-1");
    expect(card.getAttribute("aria-label")).toBe("Workflow completed");
    expect(view.getByTestId("workflow-card-kind").textContent).toBe("Workflow completed");
    expect(view.getByTestId("workflow-card-name").textContent).toBe("deep-research");
    expect(view.getByTestId("workflow-completion-status").textContent).toBe("Completed");
    expect(view.queryByTestId("workflow-card-toggle")).toBeNull();
    fireEvent.click(view.getByTestId("workflow-card-open-details"));
    expect(onOpenRun).toHaveBeenCalledTimes(1);

    cleanup();
    const cold = renderCard();
    expect(cold.queryByTestId("workflow-card-open-details")).toBeNull();
  });

  it("四格：时间拆成CountCharacter + 单位、tokens 紧凑写法并把全Value放进 title、Sub-agent与PhaseCount原样", () => {
    const view = renderCard();
    expect(view.getByTestId("workflow-completion-figure-time").getAttribute("data-value")).toBe(
      "11m 48s",
    );
    const tokens = view.getByTestId("workflow-completion-figure-tokens");
    expect(tokens.getAttribute("data-value")).toBe("386.4k");
    expect(tokens.querySelector("[title]")?.getAttribute("title")).toBe("386,412 tokens");
    expect(
      view.getByTestId("workflow-completion-figure-subagents").getAttribute("data-value"),
    ).toBe("10");
    expect(view.getByTestId("workflow-completion-figure-phases").getAttribute("data-value")).toBe(
      "16",
    );
    const figures = view.getByTestId("workflow-completion-figures");
    expect(figures.textContent).toContain("time");
    expect(figures.textContent).toContain("subagents");
    expect(figures.textContent).toContain("phases");
    expect(figures.textContent).not.toContain("steps");
  });

  it("拿不到的格写 `—`（带无障碍名），不写 0；时间独立于其余Three格", () => {
    const view = renderCard({ figures: { durationMs: 3_000 } });
    expect(view.getByTestId("workflow-completion-figure-time").getAttribute("data-value")).toBe(
      "3s",
    );
    for (const key of ["tokens", "subagents", "phases"]) {
      const figure = view.getByTestId(`workflow-completion-figure-${key}`);
      expect(figure.getAttribute("data-value")).toBeNull();
      expect(figure.textContent).toContain("—");
      expect(figure.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe(
        "Not available",
      );
      expect(figure.textContent).not.toContain("0");
    }
  });

  it("zh-CN：Duration单位前留空格并渲染Sub-agentTags", () => {
    const view = renderCard({ figures: { durationMs: 708_000, tokens: 5 } }, "zh-CN");
    expect(view.getByTestId("workflow-completion-figure-time").getAttribute("data-value")).toBe(
      "11 分 48 秒",
    );
    expect(view.getByTestId("workflow-completion-figures").textContent).toContain("子代理");
  });
});

describe("WorkflowCompletionCard · 产物索引", () => {
  it("没有Deliver物：索引独占产物区；细节与打开身份保真", () => {
    const onOpenArtifact = vi.fn();
    const view = renderCard({ onOpenArtifact });
    const index = view.getByTestId("workflow-completion-index");
    expect(index.className).not.toContain("border-t");
    expect(index.getAttribute("data-columns")).toBe("auto");
    const lines = view.getAllByTestId("workflow-completion-line");
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.getAttribute("data-variant") === "line")).toBe(true);
    expect(view.queryByTestId("workflow-completion-row")).toBeNull();
    expect(view.queryByTestId("workflow-artifact-tile-frame")).toBeNull();
    expect(view.queryByTestId("workflow-artifact-sheet")).toBeNull();
    const details = view.getAllByTestId("workflow-artifact-line-detail");
    expect(details[0]!.textContent).toBe("12.0 KB");
    expect(details[1]!.textContent).toContain("CSV");
    expect(details[1]!.textContent).toContain("6.0 KB");
    expect(details[2]!.textContent).toBe("4 items");
    const versions = view.getAllByTestId("workflow-artifact-tile-version");
    expect(versions).toHaveLength(1);
    expect(versions[0]!.textContent).toBe("v2");
    expect(lines[1]!.tagName).toBe("BUTTON");
    expect(lines[1]!.hasAttribute("disabled")).toBe(false);
    expect(lines[1]!.getAttribute("aria-label")).toBe("Open artifact: sources.csv");
    expect(lines[1]!.getAttribute("title")).toBe("File · sources.csv");
    expect(view.getAllByTestId("workflow-artifact-tile-open")).toHaveLength(3);
    fireEvent.click(lines[1]!);
    expect(onOpenArtifact).toHaveBeenCalledWith("sources");
    expect(view.queryByTestId("workflow-completion-more")).toBeNull();
  });

  it("没有回调：行禁用、无 aria-label、无 ↗；Version仍在", () => {
    const view = renderCard();
    const lines = view.getAllByTestId("workflow-completion-line");
    expect(lines.every((line) => line.hasAttribute("disabled"))).toBe(true);
    expect(lines[0]!.getAttribute("aria-label")).toBeNull();
    expect(view.queryByTestId("workflow-artifact-tile-open")).toBeNull();
    expect(view.getAllByTestId("workflow-artifact-tile-version")).toHaveLength(1);
  });

  it("One件产物即Deliver物：Retain预览框，没有索引", () => {
    const one = renderCard({ artifacts: ARTIFACTS.slice(0, 1) });
    expect(one.queryByTestId("workflow-completion-index")).toBeNull();
    const row = one.getByTestId("workflow-completion-row");
    expect(row.getAttribute("data-artifact-id")).toBe("brief");
    expect(one.getByTestId("workflow-artifact-row-frame")).toBeTruthy();
  });

  it("超过六件：五行 + One行「N more」——One扇门（↗ 常在，点开 run 侧板）；六件全画；砍过时「… more」且无回调则禁用", () => {
    const many = Array.from({ length: 7 }, (_unused, index) => ({
      id: `a${index}`,
      kind: "file" as const,
      title: `产物 ${index}`,
      version: 1,
    }));
    const onOpenRun = vi.fn();
    const view = renderCard({ artifacts: many, onOpenRun });
    expect(view.getAllByTestId("workflow-completion-line")).toHaveLength(COMPLETION_INDEX_MAX - 1);
    const more = view.getByTestId("workflow-completion-more") as HTMLButtonElement;
    expect(more.textContent).toBe("2 more");
    expect(more.getAttribute("data-variant")).toBe("more");
    expect(more.getAttribute("title")).toBe("Open run details");
    expect(within(more).getByTestId("workflow-artifact-tile-open").className).toContain(
      "wf-pill-go-rest",
    );
    fireEvent.click(more);
    expect(onOpenRun).toHaveBeenCalledTimes(1);
    cleanup();
    const six = renderCard({ artifacts: many.slice(0, 6) });
    expect(six.getAllByTestId("workflow-completion-line")).toHaveLength(COMPLETION_INDEX_MAX);
    expect(six.queryByTestId("workflow-completion-more")).toBeNull();
    cleanup();
    const truncated = renderCard({ artifacts: many.slice(0, 4), artifactsTruncated: true });
    expect(truncated.getAllByTestId("workflow-completion-line")).toHaveLength(4);
    const dumb = truncated.getByTestId("workflow-completion-more") as HTMLButtonElement;
    expect(dumb.textContent).toBe("… more");
    expect(dumb.disabled).toBe(true);
    expect(within(dumb).queryByTestId("workflow-artifact-tile-open")).toBeNull();
  });

  it("预览只交ToDeliver物的框：没有Deliver物时不Question预览；零产物没有产物区、卡仍画", () => {
    const renderPreview = vi.fn((_artifact: WorkflowCompletionArtifact) => undefined);
    const view = renderCard({ renderPreview });
    expect(renderPreview).not.toHaveBeenCalled();
    expect(view.getByTestId("workflow-completion-index")).toBeTruthy();
    cleanup();
    const empty = renderCard({ artifacts: [] });
    expect(empty.queryByTestId("workflow-completion-index")).toBeNull();
    expect(empty.queryByTestId("workflow-completion-row")).toBeNull();
    expect(empty.getByTestId("workflow-completion-figures")).toBeTruthy();
  });

  it("行依次落地：第 k 行延迟 k × 30 ms 且 backwards 填充；四格排在行之后", () => {
    const view = renderCard();
    const lines = view.getAllByTestId("workflow-completion-line");
    expect(lines[0]!.style.animationDelay).toBe("30ms");
    expect(lines[2]!.style.animationDelay).toBe("90ms");
    expect(lines[2]!.style.animationFillMode).toBe("backwards");
    expect(view.getByTestId("workflow-completion-figure-time").style.animationDelay).toBe("120ms");
    expect(view.getByTestId("workflow-completion-figure-phases").style.animationDelay).toBe(
      "210ms",
    );
  });
});

describe("WorkflowCompletionCard · Deliver物", () => {
  const REPORT: WorkflowCompletionArtifact = {
    id: "report",
    kind: "markdown",
    title: "季度基准Report",
    description: "对比十Two个Service的 p50 / p99 延迟与上季度基线；确认Three处回归，To出两项修复建议。",
    version: 3,
    bytes: 24_576,
    primary: true,
  };
  const others = (count: number): WorkflowCompletionArtifact[] =>
    Array.from({ length: count }, (_unused, index) => ({
      id: `n${index}`,
      kind: index === 0 ? "chart" : "markdown",
      title: `产物 ${index}`,
      version: 1,
      ...(index === 0 ? { itemCount: 12 } : { bytes: 2_048 }),
    }));

  it("Deliver物行RetainDescription、细节、Version与打开身份", () => {
    const onOpenArtifact = vi.fn();
    const view = renderCard({ artifacts: [...others(2), REPORT, ...others(1)], onOpenArtifact });
    const row = view.getByTestId("workflow-completion-row") as HTMLButtonElement;
    expect(row.tagName).toBe("BUTTON");
    expect(row.getAttribute("data-artifact-id")).toBe("report");
    expect(row.getAttribute("data-variant")).toBe("row");
    expect(view.getByTestId("workflow-artifact-row-title").textContent).toBe("季度基准Report");
    const description = view.getByTestId("workflow-artifact-row-description");
    expect(description.textContent).toContain("确认Three处回归");
    expect(view.getByTestId("workflow-artifact-row-detail").textContent).toBe("Document·24.0 KB");
    expect(within(row).getByTestId("workflow-artifact-tile-version").textContent).toBe("v3");
    expect(row.getAttribute("aria-label")).toBe("Open artifact: 季度基准Report");
    fireEvent.click(row);
    expect(onOpenArtifact).toHaveBeenCalledWith("report");
    expect(view.getByTestId("workflow-completion-card-turn-1").textContent).not.toMatch(
      /primary/iu,
    );
  });

  it("Description缺席时那One行消失、行仍在；没有回调时整行禁用", () => {
    const { description: _dropped, ...bare } = REPORT;
    const view = renderCard({ artifacts: [bare, ...others(1)] });
    expect(view.queryByTestId("workflow-artifact-row-description")).toBeNull();
    const row = view.getByTestId("workflow-completion-row") as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(row.getAttribute("aria-label")).toBeNull();
    expect(view.queryByTestId("workflow-artifact-tile-open")).toBeNull();
  });

  it("其余产物在分隔线后按原序列出：六件全画且没有门", () => {
    const view = renderCard({ artifacts: [REPORT, ...others(6)] });
    const index = view.getByTestId("workflow-completion-index");
    expect(index.className).toContain("border-t");
    const lines = view.getAllByTestId("workflow-completion-line");
    expect(lines).toHaveLength(6);
    expect(lines.map((line) => line.getAttribute("data-artifact-id"))).toEqual([
      "n0",
      "n1",
      "n2",
      "n3",
      "n4",
      "n5",
    ]);
    const details = view.getAllByTestId("workflow-artifact-line-detail");
    expect(details[0]!.textContent).toBe("12 items");
    expect(details[1]!.textContent).toBe("2.0 KB");
    expect(lines[0]!.getAttribute("title")).toBe("Chart · 产物 0");
    expect(view.queryByTestId("workflow-completion-more")).toBeNull();
    expect(view.getAllByTestId("workflow-artifact-sheet")).toHaveLength(1);
  });

  it("第七件From：五行 + 「N more」（点开 run 侧板）；zh「还有 N 个」；砍过时 `…`；无回调则禁用", () => {
    const onOpenRun = vi.fn();
    const view = renderCard({ artifacts: [REPORT, ...others(7)], onOpenRun });
    expect(view.getAllByTestId("workflow-completion-line")).toHaveLength(5);
    const more = view.getByTestId("workflow-completion-more") as HTMLButtonElement;
    expect(more.textContent).toBe("2 more");
    expect(more.getAttribute("title")).toBe("Open run details");
    fireEvent.click(more);
    expect(onOpenRun).toHaveBeenCalledTimes(1);
    cleanup();
    const zh = renderCard({ artifacts: [REPORT, ...others(7)], onOpenRun }, "zh-CN");
    expect(zh.getByTestId("workflow-completion-more").textContent).toBe("还有 2 个");
    cleanup();
    const truncated = renderCard({ artifacts: [REPORT, ...others(3)], artifactsTruncated: true });
    expect(truncated.getAllByTestId("workflow-completion-line")).toHaveLength(3);
    const dumb = truncated.getByTestId("workflow-completion-more") as HTMLButtonElement;
    expect(dumb.textContent).toBe("… more");
    expect(dumb.disabled).toBe(true);
  });

  it("预览只QuestionDeliver物One次；节拍：行 30 ms、索引行依次、门在最后One行之后、四格接在门之后", () => {
    const renderPreview = vi.fn((_artifact: WorkflowCompletionArtifact) => undefined);
    const view = renderCard({ artifacts: [REPORT, ...others(7)], renderPreview });
    expect(renderPreview.mock.calls.map(([artifact]) => artifact.id)).toEqual(["report"]);
    expect(view.getByTestId("workflow-completion-row").style.animationDelay).toBe("30ms");
    const lines = view.getAllByTestId("workflow-completion-line");
    expect(lines[0]!.style.animationDelay).toBe("60ms");
    expect(lines[4]!.style.animationDelay).toBe("180ms");
    expect(view.getByTestId("workflow-completion-more").style.animationDelay).toBe("210ms");
    expect(view.getByTestId("workflow-completion-figure-time").style.animationDelay).toBe("240ms");
    expect(view.getAllByTestId("workflow-artifact-sheet")).toHaveLength(1);
  });
});

describe("formatCompactCount / workDuration", () => {
  it("tokens 紧凑写法：千位One位小Count、百万两位；千以下原样", () => {
    expect(formatCompactCount(812)).toEqual({ value: "812", unit: "" });
    expect(formatCompactCount(386_412)).toEqual({ value: "386.4", unit: "k" });
    expect(formatCompactCount(1_304_118)).toEqual({ value: "1.30", unit: "M" });
  });

  it("Duration拆段：最多两段、至少 1 秒；与「工作了」的写法同源", () => {
    const format = ({ id }: { id: string }) => id.split(".").at(-1)!.charAt(0);
    expect(workDurationParts(0, format)).toEqual([{ value: 1, unit: "s" }]);
    expect(workDurationParts(3_725_000, format)).toEqual([
      { value: 1, unit: "h" },
      { value: 2, unit: "m" },
    ]);
    expect(formatWorkDuration(102_000, format, "en-US")).toBe("1m 42s");
    expect(formatWorkDuration(102_000, format, "zh-CN")).toBe("1 m 42 s");
    expect(formatWorkDuration(undefined, format, "en-US")).toBeNull();
  });
});
