import { describe, expect, it } from "vitest";
import type { WorkflowRunWorkspaceNode } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkspaceCardModel } from "@/app-shell/workflowWorkspaceTranscript.js";
import {
  buildWorkspaceChapters,
  formatAgo,
  formatOffset,
  isErrorLine,
  peekLinesOf,
  rememberedOpen,
  resetWorkspaceEntryOpenState,
  setRememberedOpen,
  transcriptOrigin,
  transcriptSummary,
} from "@/app-shell/workflowWorkspaceLogbook.js";

function card(
  key: string,
  phase: string | undefined,
  createdAt: number,
  updatedAt = createdAt + 100,
  status: WorkflowRunWorkspaceNode["status"] = "completed",
): WorkspaceCardModel {
  return {
    key,
    kind: "terminal",
    op: "run",
    primary: key,
    round: 1,
    node: { siteId: key, ordinal: 1, kind: "world-run", status, createdAt, updatedAt },
    ...(phase === undefined ? {} : { phase: { id: phase, name: phase } }),
  };
}

describe("buildWorkspaceChapters", () => {
  it("连续同OnePhase的卡YesOne章；再进同OnePhaseYesNew的One章、轮次 +1；章的From止Yes卡的From止", () => {
    const chapters = buildWorkspaceChapters([
      card("a", "plan", 1_000, 1_400),
      card("b", "plan", 1_200, 1_300),
      card("c", "verify", 2_000, 2_500),
      card("d", "plan", 3_000),
      card("e", "verify", 4_000),
    ]);
    expect(
      chapters.map((chapter) => [chapter.phase?.id, chapter.round, chapter.cards.length]),
    ).toEqual([
      ["plan", 1, 2],
      ["verify", 1, 1],
      ["plan", 2, 1],
      ["verify", 2, 1],
    ]);
    expect(chapters[0]).toMatchObject({ startedAt: 1_000, endedAt: 1_400 });
    expect(new Set(chapters.map((chapter) => chapter.key)).size).toBe(4);
  });

  it("没有Phase的卡归入无头的章（图不可得）", () => {
    const chapters = buildWorkspaceChapters([card("a", undefined, 1), card("b", undefined, 2)]);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.phase).toBeUndefined();
    expect(chapters[0]!.round).toBe(1);
    expect(buildWorkspaceChapters([])).toEqual([]);
  });
});

describe("time scale", () => {
  it("零点Yes最早的准入时刻；偏移写成 +m:ss，过小时带小时", () => {
    expect(transcriptOrigin([card("a", "p", 5_000), card("b", "p", 2_000)])).toBe(2_000);
    expect(transcriptOrigin([])).toBeUndefined();
    expect(formatOffset(0)).toBe("+0:00");
    expect(formatOffset(72_000)).toBe("+1:12");
    expect(formatOffset(3_725_000)).toBe("+1:02:05");
    expect(formatOffset(-5)).toBe("+0:00");
  });

  it("「多久前Start」的Three档", () => {
    expect(formatAgo(6_400)).toBe("6s");
    expect(formatAgo(125_000)).toBe("2m 05s");
    expect(formatAgo(3_660_000)).toBe("1h 01m");
  });

  it("表头Summary：PhaseCount、步Count、从第One张卡到最后One张卡结算（还在Run则到现在）", () => {
    const settled = transcriptSummary(
      [card("a", "plan", 1_000, 1_500), card("b", "verify", 2_000, 2_600)],
      9_000,
    );
    expect(settled).toEqual({ phases: 2, steps: 2, durationMs: 1_600 });
    const running = transcriptSummary(
      [card("a", "plan", 1_000, 1_500), card("b", "plan", 2_000, 2_000, "running")],
      9_000,
    );
    expect(running).toEqual({ phases: 1, steps: 2, durationMs: 8_000 });
    expect(transcriptSummary([], 1)).toEqual({ phases: 0, steps: 0, durationMs: 0 });
  });
});

describe("peekLinesOf", () => {
  it("Command：stdout 最后Three行非空行；stdout 空则 stderr；Error行按启发式LabelRed", () => {
    expect(
      peekLinesOf({ exitCode: 1, stdout: "a\n\nb\nc\n × failed thing\n", stderr: "" }),
    ).toEqual([
      { text: "b", error: false },
      { text: "c", error: false },
      { text: " × failed thing", error: true },
    ]);
    expect(peekLinesOf({ exitCode: 1, stdout: "  \n", stderr: "Error: boom" })).toEqual([
      { text: "Error: boom", error: true },
    ]);
    expect(peekLinesOf("one\ntwo", 1)).toEqual([{ text: "two", error: false }]);
    expect(peekLinesOf(["a", "b"])).toEqual([]);
    expect(peekLinesOf(undefined)).toEqual([]);
  });

  it("isErrorLine：× / ✗ / FAIL / Error: 开头or含 Error:", () => {
    expect(isErrorLine("× parses nested blocks")).toBe(true);
    expect(isErrorLine("FAIL src/a.test.ts")).toBe(true);
    expect(isErrorLine("AssertionError: expected")).toBe(true);
    expect(isErrorLine("✓ src/a.test.ts (3 tests)")).toBe(false);
    expect(isErrorLine("Build completed successfully.")).toBe(false);
  });
});

describe("open-state memory", () => {
  it("按键记住展开态，Reset后归零", () => {
    resetWorkspaceEntryOpenState();
    expect(rememberedOpen("k")).toBe(false);
    setRememberedOpen("k", true);
    expect(rememberedOpen("k")).toBe(true);
    resetWorkspaceEntryOpenState();
    expect(rememberedOpen("k")).toBe(false);
  });
});
