import { describe, expect, it } from "vitest";
import type { WorkflowRunState, WorkflowRunWorkspaceNode } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import {
  buildWorkspaceCards,
  firstCardIndexOfPhase,
  formatCommandLine,
  formatWorkspaceBytes,
  formatWorkspaceDuration,
  isTimeoutError,
  workspaceCardKindOf,
  workspaceCardStatus,
} from "@/app-shell/workflowWorkspaceTranscript.js";

const GRAPH: WorkflowCausalityGraphData = {
  steps: [
    { id: "ask#1", kind: "ask", label: "plan", lane: "actor#1", phase: "phase#a" },
    {
      id: "world-read#1",
      kind: "world-read",
      label: "glob src*.ts"] }),
        node({ siteId: "world-read#2", op: "git-diff", args: ["src/"] }),
        node({
          siteId: "world-read#2",
          ordinal: 2,
          kind: "world-run",
          op: "run",
          args: ["pnpm", ["vitest", "run", "a b"], { timeoutMs: 1 }],
        }),
      ],
      GRAPH,
    );
    expect(cards.map((card) => card.kind)).toEqual(["read", "search", "git", "terminal"]);
    expect(cards[0]).toMatchObject({
      primary: "src/a.ts",
      round: 1,
      phase: { id: "phase#a", name: "plan" },
    });
    expect(cards[1]).toMatchObject({ primary: "TODO", secondary: "src/**/*.ts", round: 2 });
    expect(cards[2]).toMatchObject({
      primary: "git diff src/",
      secondary: "src/",
      phase: { id: "phase#b" },
    });
    expect(cards[3]).toMatchObject({
      primary: 'pnpm vitest run "a b"',
      command: 'pnpm vitest run "a b"',
      round: 2,
    });
    expect(cards.map((card) => card.key)).toEqual([
      "world-read#1@1",
      "world-read#1@2",
      "world-read#2@1",
      "world-read#2@2",
    ]);
  });

  it("Upgrade前的历史行（无 op）Returned静态图上的步Tags；图不可得时Returned站点 id、没有Phase", () => {
    const [withGraph] = buildWorkspaceCards([node({})], GRAPH);
    expect(withGraph).toMatchObject({
      kind: "step",
      primary: "glob src/**",
      phase: { id: "phase#a" },
    });
    const [noGraph] = buildWorkspaceCards([node({ op: "read", args: ["x"] })], undefined);
    expect(noGraph?.primary).toBe("x");
    expect(noGraph?.phase).toBeUndefined();
    const [unknownSite] = buildWorkspaceCards([node({ siteId: "world-read#9" })], GRAPH);
    expect(unknownSite?.primary).toBe("world-read#9");
  });

  it("截断Mode下的Array实参Yes JSON 预览Text：Command行原样带上它", () => {
    const [card] = buildWorkspaceCards(
      [node({ kind: "world-run", op: "run", args: ["node", '["-e","…'], inputTruncated: true })],
      undefined,
    );
    expect(card?.command).toBe('node "[\\"-e\\",\\"…"');
  });
});

describe("workspaceCardStatus", () => {
  it("Status以 journal 行为准；活投影只叠 cached（replayed 芯片）", () => {
    const run = {
      runId: "r",
      status: "running",
      usage: { spentTokens: 0, nodesUsed: 0 },
      actors: [],
      nodes: [
        { siteId: "world-read#1", ordinal: 1, phase: "settled", outcome: "ok", cached: true },
      ],
      lastEventSequence: 3,
    } as unknown as WorkflowRunState;
    expect(workspaceCardStatus(node({ status: "running" }), run)).toEqual({
      status: "running",
      replayed: true,
    });
    expect(workspaceCardStatus(node({ ordinal: 2 }), run)).toEqual({
      status: "completed",
      replayed: false,
    });
    expect(workspaceCardStatus(node({}), undefined).replayed).toBe(false);
  });
});

describe("firstCardIndexOfPhase", () => {
  it("落点Yes该Phase的第One张卡；Phase还没到 → -1", () => {
    const cards = buildWorkspaceCards(
      [
        node({ op: "read", args: ["a"] }),
        node({ siteId: "world-read#2", op: "git-status", args: [] }),
      ],
      GRAPH,
    );
    expect(firstCardIndexOfPhase(cards, "phase#a")).toBe(0);
    expect(firstCardIndexOfPhase(cards, "phase#b")).toBe(1);
    expect(firstCardIndexOfPhase(cards, "phase#z")).toBe(-1);
  });
});

describe("formatters", () => {
  it("Command行：带空格的实参加引Number", () => {
    expect(formatCommandLine("git", ["log", "-n", "5"])).toBe("git log -n 5");
    expect(formatCommandLine("echo", ["hello world"])).toBe('echo "hello world"');
  });

  it("耗时与Character节Count的Three档", () => {
    expect(formatWorkspaceDuration(840)).toBe("840ms");
    expect(formatWorkspaceDuration(1_300)).toBe("1.3s");
    expect(formatWorkspaceDuration(125_000)).toBe("2m 05s");
    expect(formatWorkspaceBytes(312)).toBe("312 B");
    expect(formatWorkspaceBytes(4_200)).toBe("4.1 KB");
    expect(formatWorkspaceBytes(1_300_000)).toBe("1.2 MB");
  });

  it("超时的判据：code or message 说 timeout", () => {
    expect(
      isTimeoutError({ code: "DriverError", message: "command timed out after 300000ms" }),
    ).toBe(true);
    expect(isTimeoutError({ code: "WorldRunTimeout", message: "x" })).toBe(true);
    expect(isTimeoutError({ code: "DriverError", message: "spawn ENOENT" })).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
  });
});
