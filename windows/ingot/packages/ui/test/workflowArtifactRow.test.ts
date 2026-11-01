// @vitest-environment jsdom

// （`resolvePrimaryArtifact` / `orderArtifactsPrimaryFirst`，docs/dynamic-workflow/authoring.md「Ids, tags and versions」）。
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import {
  buildPresetLabels,
  orderArtifactsPrimaryFirst,
  resolvePrimaryArtifact,
} from "@/app-shell/workflow-artifacts/artifactPresentation.js";
import { WorkflowArtifactRow } from "@/components/workflow-timeline/WorkflowArtifactRow.js";
import type { WorkflowCompletionArtifact } from "@/components/workflow-timeline/WorkflowArtifactTile.js";

afterEach(() => {
  cleanup();
});

const REPORT: WorkflowCompletionArtifact = {
  id: "report",
  kind: "file",
  title: "季度基准Report",
  description: "对比十Two个Service的 p50 / p99 延迟与上季度基线。",
  contentType: "application/pdf",
  sourcePath: "out/report.pdf",
  bytes: 4_194_304,
  version: 2,
  primary: true,
};

function renderRow(
  artifact: WorkflowCompletionArtifact,
  options: { locale?: "en-US" | "zh-CN"; onOpen?: (id: string) => void; title?: string } = {},
) {
  const labels = buildPresetLabels((descriptor) => descriptor.id.split(".").at(-1)!);
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: options.locale ?? "en-US" },
      createElement(WorkflowArtifactRow, {
        artifact,
        labels,
        ...(options.onOpen === undefined ? {} : { onOpen: options.onOpen }),
        ...(options.title === undefined ? {} : { title: options.title }),
      }),
    ),
  );
}

describe("WorkflowArtifactRow", () => {
  it("One颗按钮：预览框Yes inert 兄弟节点；细节、Version与打开回调保真", () => {
    const onOpen = vi.fn();
    const view = renderRow(REPORT, { onOpen });
    const row = view.getByTestId("workflow-artifact-row") as HTMLButtonElement;
    expect(row.tagName).toBe("BUTTON");
    const shell = row.parentElement!;
    expect(row.className).toContain("wf-tile-hit");
    const frame = view.getByTestId("workflow-artifact-row-frame");
    expect(frame.parentElement).toBe(shell);
    expect(frame.hasAttribute("inert")).toBe(true);
    expect(row.contains(frame)).toBe(false);
    expect(row.getAttribute("data-variant")).toBe("row");
    expect(row.getAttribute("title")).toBe("File · 季度基准Report");
    const detail = view.getByTestId("workflow-artifact-row-detail");
    expect(detail.textContent).toBe("File·PDF·4.00 MB");
    expect(view.getByTestId("workflow-run-artifact-badge").textContent).toBe("PDF");
    expect(view.getByTestId("workflow-run-artifact-bytes").textContent).toBe("4.00 MB");
    expect(view.getByTestId("workflow-artifact-tile-version").textContent).toBe("v2");
    expect(view.getByTestId("workflow-artifact-tile-open")).toBeTruthy();
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith("report");
    expect(row.textContent).not.toMatch(/primary/iu);
  });

  it("没有回调：禁用、无 aria-label、无 ↗；Description与Version仍在；tooltip 可由宿主覆盖", () => {
    const view = renderRow(REPORT, { title: "File · 季度基准Report\nout/report.pdf" });
    const row = view.getByTestId("workflow-artifact-row") as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(row.getAttribute("aria-label")).toBeNull();
    expect(view.queryByTestId("workflow-artifact-tile-open")).toBeNull();
    expect(view.getByTestId("workflow-artifact-tile-version").textContent).toBe("v2");
    expect(row.getAttribute("title")).toBe("File · 季度基准Report\nout/report.pdf");
  });

  it("看板的细节Yes条Count；Description缺席时那One行不画；v1 不写Version；zh-CN 的 kind 词", () => {
    const view = renderRow(
      { id: "perf", kind: "chart", title: "每轮耗时", version: 1, itemCount: 12 },
      { locale: "zh-CN" },
    );
    expect(view.queryByTestId("workflow-artifact-row-description")).toBeNull();
    expect(view.queryByTestId("workflow-artifact-tile-version")).toBeNull();
    expect(view.getByTestId("workflow-artifact-row-detail").textContent).toBe("图表·items");
    cleanup();
    const bare = renderRow({ id: "notes", kind: "markdown", version: 1 });
    expect(bare.getByTestId("workflow-artifact-row-detail").textContent).toBe("Document");
  });
});

describe("resolvePrimaryArtifact / orderArtifactsPrimaryFirst", () => {
  const a = { id: "a" };
  const b = { id: "b", primary: true as const };
  const c = { id: "c" };

  it("旗子优先，LocationIrrelevant；没有旗子时只有单件才算Deliver物；两件以上无旗子 ⇒ 没有", () => {
    expect(resolvePrimaryArtifact([a, b, c])).toBe(b);
    expect(resolvePrimaryArtifact([a])).toBe(a);
    expect(resolvePrimaryArtifact([a, c])).toBeUndefined();
    expect(resolvePrimaryArtifact([])).toBeUndefined();
  });

  it("Deliver物带头，其余保持原顺序；没有旗子时原样Copy（不按单件规则重排——只有One件也没什么可排）", () => {
    expect(orderArtifactsPrimaryFirst([a, b, c]).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(orderArtifactsPrimaryFirst([b, a, c]).map((x) => x.id)).toEqual(["b", "a", "c"]);
    const plain = [a, c];
    const copy = orderArtifactsPrimaryFirst(plain);
    expect(copy).toEqual(plain);
    expect(copy).not.toBe(plain);
  });
});
