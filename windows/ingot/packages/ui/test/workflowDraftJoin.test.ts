import { describe, expect, it } from "vitest";
import type { ConversationRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import { buildWorkflowDraftByToolCallId } from "@/v4/workflowDraftJoin.js";

let seq = 0;

function workflowRow(options: {
  toolCallId: string;
  turnId?: string;
  toolName?: string;
  runId?: string;
  ok?: boolean;
  status?: string;
  
  legacyDisplay?: boolean;
}): ConversationRow {
  seq += 1;
  return {
    rowId: seq,
    turnId: options.turnId ?? "turn-1",
    createdAt: 1_700_000_000_000 + seq,
    createdAtSeq: seq,
    kind: "toolCall",
    toolCallId: options.toolCallId,
    toolName: options.toolName ?? "CreateWorkflow",
    status: options.status ?? "success",
    inputText: "{}",
    input: {
      script: "phase('a')",
      ...(options.runId === undefined ? {} : { run_id: options.runId }),
    },
    ...displayFields(options.ok, options.legacyDisplay === true),
  } as unknown as ConversationRow;
}

function displayFields(ok: boolean | undefined, legacy: boolean): Record<string, unknown> {
  if (ok === undefined) return {};
  const display = {
    kind: "create_workflow",
    ok,
    errorCount: ok ? 0 : 1,
    diagnostics: ok ? [] : [{ line: 1, column: 1, code: 2304, message: "boom" }],
  };
  return legacy ? { display } : { output: { text: "", display } };
}

function otherRow(toolCallId: string, turnId = "turn-1"): ConversationRow {
  seq += 1;
  return {
    rowId: seq,
    turnId,
    createdAt: 1_700_000_000_000 + seq,
    createdAtSeq: seq,
    kind: "toolCall",
    toolCallId,
    toolName: "Read",
    status: "success",
    inputText: "{}",
    input: { file_path: "/a.ts" },
  } as unknown as ConversationRow;
}

describe("buildWorkflowDraftByToolCallId", () => {
  it("同One轮里连续编不过：稿Number逐个加One，除最后One稿outer都被替代", () => {
    const drafts = buildWorkflowDraftByToolCallId([
      workflowRow({ toolCallId: "a", ok: false }),
      otherRow("read-1"),
      workflowRow({ toolCallId: "b", ok: false }),
      workflowRow({ toolCallId: "c", status: "inputStreaming" }),
    ]);
    expect(drafts.get("a")).toEqual({ ordinal: 1, superseded: true });
    expect(drafts.get("b")).toEqual({ ordinal: 2, superseded: true });
    expect(drafts.get("c")).toEqual({ ordinal: 3, superseded: false });
    expect(drafts.has("read-1")).toBe(false);
  });

  it("编过的One稿（display.ok）把谱系清零：下One次Submit重New从Draft 1CountFrom", () => {
    const drafts = buildWorkflowDraftByToolCallId([
      workflowRow({ toolCallId: "a", ok: false }),
      workflowRow({ toolCallId: "b", ok: true }),
      workflowRow({ toolCallId: "c", ok: false }),
    ]);
    expect(drafts.get("b")).toEqual({ ordinal: 2, superseded: true });
    expect(drafts.get("c")).toEqual({ ordinal: 1, superseded: false });
  });

  it("没有 display 的行（待确认、被拒、Cancel）既不计Count也不清零", () => {
    const drafts = buildWorkflowDraftByToolCallId([
      workflowRow({ toolCallId: "a", ok: false }),
      workflowRow({ toolCallId: "b", status: "cancelled" }),
      workflowRow({ toolCallId: "c", ok: false }),
    ]);
    expect(drafts.get("b")).toEqual({ ordinal: 2, superseded: true });
    expect(drafts.get("c")).toEqual({ ordinal: 2, superseded: false });
    expect(drafts.get("a")?.superseded).toBe(true);
  });

  it("New的One轮从Draft 1CountFrom，但仍然替代Previous round停在那里的Draft", () => {
    const drafts = buildWorkflowDraftByToolCallId([
      workflowRow({ toolCallId: "a", ok: false, turnId: "turn-1" }),
      workflowRow({ toolCallId: "b", ok: false, turnId: "turn-1" }),
      workflowRow({ toolCallId: "c", ok: false, turnId: "turn-2" }),
    ]);
    expect(drafts.get("b")).toEqual({ ordinal: 2, superseded: true });
    expect(drafts.get("c")).toEqual({ ordinal: 1, superseded: false });
  });

  it("修订按Predecessor run 各自成谱系，与创建互不E干", () => {
    const drafts = buildWorkflowDraftByToolCallId([
      workflowRow({ toolCallId: "create-1", ok: false }),
      workflowRow({ toolCallId: "amend-x1", toolName: "AmendWorkflow", runId: "run-x", ok: false }),
      workflowRow({ toolCallId: "amend-y1", toolName: "AmendWorkflow", runId: "run-y", ok: false }),
      workflowRow({
        toolCallId: "amend-x2",
        toolName: "AmendWorkflow",
        runId: "run-x",
        status: "inputStreaming",
      }),
    ]);
    expect(drafts.get("create-1")).toEqual({ ordinal: 1, superseded: false });
    expect(drafts.get("amend-x1")).toEqual({ ordinal: 1, superseded: true });
    expect(drafts.get("amend-y1")).toEqual({ ordinal: 1, superseded: false });
    expect(drafts.get("amend-x2")).toEqual({ ordinal: 2, superseded: false });
  });

  it("Tools名按 wire 写法归One（create_workflow 也算）；Old快照顶层 display 同样读；非Tools行与空Window不出Wrong", () => {
    const drafts = buildWorkflowDraftByToolCallId([
      { kind: "assistantText", rowId: 1, turnId: "turn-1" } as unknown as ConversationRow,
      workflowRow({ toolCallId: "a", toolName: "create_workflow", ok: false }),
      workflowRow({ toolCallId: "b", ok: false, legacyDisplay: true }),
    ]);
    expect(drafts.get("a")).toEqual({ ordinal: 1, superseded: true });
    expect(drafts.get("b")).toEqual({ ordinal: 2, superseded: false });
    expect(buildWorkflowDraftByToolCallId(undefined).size).toBe(0);
  });
});
