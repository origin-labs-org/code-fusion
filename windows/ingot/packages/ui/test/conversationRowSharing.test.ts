import { describe, expect, it } from "vitest";
import type { ConversationRow, ToolCallRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import { ConversationRowPool, shareStructure } from "@/v4/conversationRowSharing.js";

function fresh<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function bigToolRow(rowId: number, status: ToolCallRow["status"] = "running"): ToolCallRow {
  const content = `inner容-${rowId}-`.repeat(2000);
  return {
    rowId,
    turnId: "t1",
    createdAt: 1,
    createdAtSeq: rowId,
    kind: "toolCall",
    toolCallId: `call-${rowId}`,
    toolName: "Write",
    status,
    input: { file_path: "/a.txt", content },
    inputText: JSON.stringify({ file_path: "/a.txt", content }),
  };
}

describe("shareStructure", () => {
  it("Return prev itself on deep equality", () => {
    const prev = { a: 1, b: { c: ["x", { d: null }] } };
    expect(shareStructure(prev, fresh(prev))).toBe(prev);
  });

  it("Create a new wrapper on partial change and reuse unchanged sub-values", () => {
    const prev = { keep: { deep: [1, 2] }, change: { v: 1 }, text: "长文本" };
    const next = { keep: { deep: [1, 2] }, change: { v: 2 }, text: "长文本" };
    const shared = shareStructure(prev, next);
    expect(shared).not.toBe(prev);
    expect(shared).toEqual(next);
    expect(shared.keep).toBe(prev.keep);
    expect(shared.change).toBe(next.change);
  });

  it("Do not mutate next; preserve key order of next", () => {
    const prev = { a: { x: 1 }, b: 1 };
    const next = { b: 2, a: { x: 1 } };
    const snapshot = JSON.stringify(next);
    const nextA = next.a;
    const shared = shareStructure(prev, next);
    expect(JSON.stringify(next)).toBe(snapshot);
    expect(next.a).toBe(nextA);
    expect(Object.keys(shared)).toEqual(["b", "a"]);
  });

  it("Do not reuse prev when keys differ or types differ", () => {
    expect(shareStructure({ a: 1 }, { a: 1, b: undefined })).toEqual({ a: 1, b: undefined });
    expect(shareStructure({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    expect(shareStructure([1, 2], [1, 2, 3])).toEqual([1, 2, 3]);
    const arr = [1];
    expect(shareStructure({ 0: 1 }, arr)).toBe(arr);
    expect(shareStructure(1, 2)).toBe(2);
  });

  it("Share array elements individually", () => {
    const prev = [{ id: 1 }, { id: 2 }];
    const next = [{ id: 1 }, { id: 3 }];
    const shared = shareStructure(prev, next);
    expect(shared[0]).toBe(prev[0]);
    expect(shared[1]).toBe(next[1]);
  });
});

describe("ConversationRowPool", () => {
  it("Reuse old object for rows with identical content under the same topic and rowId", () => {
    const pool = new ConversationRowPool();
    const first = pool.shareRow("conversation/s1", bigToolRow(1));
    const again = pool.shareRow("conversation/s1", fresh(bigToolRow(1)));
    expect(again).toBe(first);
  });

  it("Reuse unchanged large inputs when row state changes", () => {
    const pool = new ConversationRowPool();
    const first = pool.shareRow("conversation/s1", bigToolRow(1)) as ToolCallRow;
    const done = pool.shareRow("conversation/s1", fresh(bigToolRow(1, "success"))) as ToolCallRow;
    expect(done).not.toBe(first);
    expect(done.status).toBe("success");
    expect(done.input).toBe(first.input);
    expect(done.inputText).toBe(first.inputText);
  });

  it("Do not share across different topics", () => {
    const pool = new ConversationRowPool();
    const a = pool.shareRow("conversation/s1", bigToolRow(1));
    const b = pool.shareRow("conversation/s2", fresh(bigToolRow(1)));
    expect(b).not.toBe(a);
  });

  it("remember 登记的行供后续共享", () => {
    const pool = new ConversationRowPool();
    const streamed = bigToolRow(1);
    pool.remember("conversation/s1", streamed);
    expect(pool.shareRow("conversation/s1", fresh(streamed))).toBe(streamed);
  });

  it("shareWindow 在所有行都未变化时复用 prev 数组", () => {
    const pool = new ConversationRowPool();
    const rows: ConversationRow[] = [bigToolRow(1), bigToolRow(2)];
    const window = pool.shareWindow("conversation/s1", rows);
    expect(window).toBe(rows);
    const again = pool.shareWindow("conversation/s1", fresh(rows), window);
    expect(again).toBe(window);
    const grown = pool.shareWindow("conversation/s1", fresh([...rows, bigToolRow(3)]), window);
    expect(grown).not.toBe(window);
    expect(grown[0]).toBe(window[0]);
    expect(grown[1]).toBe(window[1]);
  });
});
