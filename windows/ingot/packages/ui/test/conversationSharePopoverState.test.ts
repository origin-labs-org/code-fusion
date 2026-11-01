import { beforeEach, describe, expect, it } from "vitest";
import {
  getConversationShareSelectedRowIds,
  getConversationShareSelectedProductTurnIds,
  useConversationShareSelectionStore,
} from "@/store/conversationShareSelectionStore.js";
const state = () => useConversationShareSelectionStore.getState();
describe("Scope transactions for share popover", () => {
  beforeEach(() => state().resetForTests());
  const prepare = () => {
    state().openShare("a");
    state().syncAvailableTurns("a", [
      { rowId: 1, productTurnId: "t1" },
      { rowId: 2, productTurnId: "t1" },
      { rowId: 3, productTurnId: "t2" },
    ]);
  };
  it("pending budget selection keeps committed turns intact and bulk updates each turn once", () => {
    prepare();
    state().beginSelectionEdit("a");
    state().setAllPendingRowsSelected("a", false);
    expect(getConversationShareSelectedProductTurnIds(state(), "a", "pending")).toEqual([]);
    expect(getConversationShareSelectedProductTurnIds(state(), "a")).toEqual(["t1", "t2"]);
    state().setAllPendingRowsSelected("a", true);
    expect(getConversationShareSelectedProductTurnIds(state(), "a", "pending")).toEqual([
      "t1",
      "t2",
    ]);
    state().togglePendingRow("a", 1);
    expect(getConversationShareSelectedProductTurnIds(state(), "a", "pending")).toEqual(["t2"]);
    state().cancelSelectionEdit("a");
    expect(getConversationShareSelectedProductTurnIds(state(), "a", "pending")).toEqual([
      "t1",
      "t2",
    ]);
  });
  it("Cancel to roll back; changes take effect only upon confirmation, and turns are selected together", () => {
    prepare();
    state().beginSelectionEdit("a");
    state().togglePendingRow("a", 1);
    expect(getConversationShareSelectedRowIds(state(), "a")).toEqual([1, 2, 3]);
    expect(state().drafts.a.pendingExcludedRowIds).toEqual([1, 2]);
    state().cancelSelectionEdit("a");
    expect(getConversationShareSelectedRowIds(state(), "a")).toEqual([1, 2, 3]);
    state().beginSelectionEdit("a");
    state().togglePendingRow("a", 1);
    state().confirmSelectionEdit("a");
    expect(getConversationShareSelectedRowIds(state(), "a")).toEqual([3]);
  });
  it("Empty selection cannot be confirmed; canceling retains disclosure confirmation; closing and reopening retains draft", () => {
    prepare();
    state().updateDockState("a", {
      title: "保留标题",
      disclosureAccepted: true,
    });
    state().beginSelectionEdit("a");
    state().togglePendingRow("a", 1);
    state().togglePendingRow("a", 3);
    state().confirmSelectionEdit("a");
    expect(state().drafts.a.pendingExcludedRowIds).not.toBeNull();
    state().cancelSelectionEdit("a");
    expect(state().dockStates.a.disclosureAccepted).toBe(true);
    state().closeShare("a");
    state().openShare("a");
    expect(state().dockStates.a.title).toBe("保留标题");
    expect(state().drafts.a.open).toBe(true);
  });
  it("发布锁定和会话隔离", () => {
    prepare();
    state().openShare("b");
    state().updateDockState("a", { publishing: true });
    state().closeShare("a");
    state().beginSelectionEdit("a");
    expect(state().drafts.a.open).toBe(true);
    expect(state().drafts.a.pendingExcludedRowIds).toBeNull();
    state().closeShare("b");
    expect(state().drafts.b.open).toBe(false);
  });
  it("Closing and reopening after failure retains draft and original request for retrying in place", () => {
    prepare();
    state().beginSelectionEdit("a");
    state().togglePendingRow("a", 3);
    state().confirmSelectionEdit("a");
    state().updateDockState("a", {
      disclosureAccepted: true,
      attempt: { key: "retry", clientRequestId: "retry-request", disclosureAcceptedAt: 1 },
      error: { issues: [], issueCount: 0, messageId: "conversationShare.issue.unknown" },
    });
    const dock = state().dockStates.a;
    state().closeShare("a");
    state().openShare("a");
    expect(state().dockStates.a).toBe(dock);
    expect(getConversationShareSelectedRowIds(state(), "a")).toEqual([1, 2]);
  });
  it("Reopening after success starts a new share, retaining title permissions and resetting scope and publish confirmation", () => {
    prepare();
    state().setAccessMode("a", "public_readonly");
    state().beginSelectionEdit("a");
    state().togglePendingRow("a", 1);
    state().confirmSelectionEdit("a");
    state().updateDockState("a", {
      title: "再次分享",
      disclosureAccepted: true,
      publishedShareUrl: "https://example.com/share/old",
      attempt: { key: "old", clientRequestId: "old-request", disclosureAcceptedAt: 1 },
      progress: "checking",
      completedArtifacts: 2,
      totalArtifacts: 2,
      warnings: { issues: [], issueCount: 1 },
    });
    state().closeShare("a");
    state().openShare("a");
    expect(state().dockStates.a).toMatchObject({
      title: "再次分享",
      disclosureAccepted: false,
      publishedShareUrl: null,
      attempt: null,
      progress: "collecting",
      completedArtifacts: 0,
      totalArtifacts: 0,
      warnings: null,
      error: null,
    });
    expect(state().drafts.a.accessMode).toBe("public_readonly");
    expect(getConversationShareSelectedRowIds(state(), "a")).toEqual([1, 2, 3]);
    state().beginSelectionEdit("a");
    expect(state().drafts.a.pendingExcludedRowIds).toEqual([]);
  });
});

it("A/B 标题权限、范围、披露、发布进度和结果分别归属各自任务", () => {
  state().resetForTests();
  for (const id of ["a", "b"]) {
    state().openShare(id);
    state().syncAvailableTurns(id, [
      { rowId: 1, productTurnId: "t1" },
      { rowId: 2, productTurnId: "t2" },
    ]);
  }
  state().setAccessMode("a", "public_readonly");
  state().updateDockState("a", { title: "A", disclosureAccepted: true });
  state().beginSelectionEdit("a");
  state().togglePendingRow("a", 1);
  state().confirmSelectionEdit("a");
  state().updateDockState("a", { publishing: true, progress: "uploading", completedArtifacts: 2 });
  const aDraft = state().drafts.a;
  const aDock = state().dockStates.a;
  state().updateDockState("b", {
    title: "B",
    disclosureAccepted: true,
    publishedShareUrl: "https://example.com/b",
  });
  state().closeShare("b");
  state().openShare("b");
  expect(state().drafts.a).toBe(aDraft);
  expect(state().dockStates.a).toBe(aDock);
  expect(state().drafts.b.accessMode).toBe("public_importable");
  expect(getConversationShareSelectedProductTurnIds(state(), "b")).toEqual(["t1", "t2"]);
  expect(state().dockStates.b).toMatchObject({
    title: "B",
    publishing: false,
    progress: "collecting",
    completedArtifacts: 0,
    publishedShareUrl: null,
    disclosureAccepted: false,
  });
  state().updateDockState("a", { publishing: false, publishedShareUrl: "https://example.com/a" });
  expect(state().dockStates.b.publishedShareUrl).toBeNull();
});

it("All scope transaction commands are disabled during publishing", () => {
  state().resetForTests();
  state().openShare("a");
  state().syncAvailableTurns("a", [{ rowId: 1, productTurnId: "t1" }]);
  state().beginSelectionEdit("a");
  state().updateDockState("a", { publishing: true });
  const draft = state().drafts.a;
  state().togglePendingRow("a", 1);
  state().setAllPendingRowsSelected("a", false);
  state().confirmSelectionEdit("a");
  state().cancelSelectionEdit("a");
  state().closeShare("a");
  expect(state().drafts.a).toBe(draft);
});

it.each(["confirm", "cancel"])("Full-turn removal in issue details respects pending transaction: %s", (action) => {
  state().resetForTests();
  state().openShare("a");
  state().syncAvailableTurns("a", [
    { rowId: 1, productTurnId: "t1" },
    { rowId: 2, productTurnId: "t1" },
    { rowId: 3, productTurnId: "t2" },
  ]);
  state().updateDockState("a", { disclosureAccepted: true });
  state().beginSelectionEdit("a");
  state().deselectProductTurn("a", "t1");
  state().deselectProductTurn("a", "t1");
  expect(state().drafts.a.pendingExcludedRowIds).toEqual([1, 2]);
  expect(getConversationShareSelectedProductTurnIds(state(), "a")).toEqual(["t1", "t2"]);
  expect(getConversationShareSelectedProductTurnIds(state(), "a", "pending")).toEqual(["t2"]);
  expect(state().dockStates.a.disclosureAccepted).toBe(true);
  if (action === "confirm") state().confirmSelectionEdit("a");
  else state().cancelSelectionEdit("a");
  expect(getConversationShareSelectedProductTurnIds(state(), "a")).toEqual(
    action === "confirm" ? ["t2"] : ["t1", "t2"],
  );
  expect(state().dockStates.a.disclosureAccepted).toBe(action === "cancel");
});

it("Full-turn removal takes effect immediately and resets disclosure during configuration, and is ignored during publishing", () => {
  state().resetForTests();
  state().openShare("a");
  state().syncAvailableTurns("a", [
    { rowId: 1, productTurnId: "t1" },
    { rowId: 2, productTurnId: "t2" },
  ]);
  state().updateDockState("a", { disclosureAccepted: true });
  state().deselectProductTurn("a", "t1");
  expect(getConversationShareSelectedProductTurnIds(state(), "a")).toEqual(["t2"]);
  expect(state().dockStates.a.disclosureAccepted).toBe(false);
  state().updateDockState("a", { publishing: true });
  state().deselectProductTurn("a", "t2");
  expect(getConversationShareSelectedProductTurnIds(state(), "a")).toEqual(["t2"]);
});

it.each(["reopen", "running-completed", "pending-cancel"])(
  "Disclosure is invalidated when candidate sync expands the confirmed scope: %s",
  (mode) => {
    state().resetForTests();
    const turns = [
      { rowId: 1, productTurnId: "t1" },
      { rowId: 2, productTurnId: "t2" },
    ];
    state().openShare("a");
    state().syncAvailableTurns("a", turns);
    state().deselectProductTurn("a", "t2");
    state().updateDockState("a", { disclosureAccepted: true });
    if (mode === "reopen") {
      state().closeShare("a");
      state().openShare("a");
    }
    if (mode === "pending-cancel") {
      state().beginSelectionEdit("a");
      state().deselectProductTurn("a", "t1");
    }
    state().syncAvailableTurns("a", [...turns, { rowId: 3, productTurnId: "private-new-turn" }]);
    expect(state().dockStates.a.disclosureAccepted).toBe(false);
    if (mode === "pending-cancel") state().cancelSelectionEdit("a");
    expect(getConversationShareSelectedProductTurnIds(state(), "a")).toEqual([
      "t1",
      "private-new-turn",
    ]);
    expect(state().dockStates.a.disclosureAccepted).toBe(false);
  },
);

it("Retain disclosure when candidate order, same-turn query, or unselected turns change while effective scope remains unchanged", () => {
  state().resetForTests();
  state().openShare("a");
  state().syncAvailableTurns("a", [
    { rowId: 1, productTurnId: "t1" },
    { rowId: 2, productTurnId: "t2" },
  ]);
  state().deselectProductTurn("a", "t2");
  state().updateDockState("a", { disclosureAccepted: true });
  state().closeShare("a");
  state().openShare("a");
  state().syncAvailableTurns("a", [
    { rowId: 3, productTurnId: "t1" },
    { rowId: 1, productTurnId: "t1" },
  ]);
  expect(getConversationShareSelectedProductTurnIds(state(), "a")).toEqual(["t1"]);
  expect(state().dockStates.a.disclosureAccepted).toBe(true);
});
