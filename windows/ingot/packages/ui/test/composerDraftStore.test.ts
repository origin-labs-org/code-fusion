import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearV4ComposerDraft,
  clearV4ComposerDraftTaskGroup,
  getV4ComposerDraftStorageKey,
  persistV4ComposerDraft,
  readV4ComposerDraft,
  V4_DRAFT_SCOPE_ROOT,
  ensurePendingTaskDraft,
  readPendingTaskDraft,
  completePendingTaskDraft,
  bindPendingTaskDraft,
} from "@/v4/composer/composerDraftStore.js";

const selection = {
  providerId: "personal-provider",
  modelId: "model-a",
  options: { reasoningLevel: "high" },
};
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
};
const workspace = "/workspace";
const read = (scope = "session-a") => readV4ComposerDraft(workspace, undefined, scope);

describe("Composer Draft 持久选择", () => {
  it("Closing project group draft only modifies that project and does not affect other projects in same directory", () => {
    const p = { clientNamespace: "desktop", hostId: "local", projectId: "p" };
    const q = { ...p, projectId: "q" };
    for (const scope of [p, q])
      persistV4ComposerDraft(
        workspace,
        undefined,
        V4_DRAFT_SCOPE_ROOT,
        { text: scope.projectId, taskGroupId: "g" },
        scope,
      );
    clearV4ComposerDraftTaskGroup(workspace, undefined, p);
    expect(readV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, p)).toMatchObject({
      text: "p",
    });
    expect(
      readV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, p)?.taskGroupId,
    ).toBeUndefined();
    expect(readV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, q)?.taskGroupId).toBe(
      "g",
    );
  });
  it("Closing group draft row only clears group intent, preserving content, project, and model", () => {
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, {
      text: "继续编辑",
      projectId: "p",
      taskGroupId: "g",
      modelSelection: selection,
    });
    clearV4ComposerDraftTaskGroup(workspace, undefined);
    expect(read(V4_DRAFT_SCOPE_ROOT)).toMatchObject({
      text: "继续编辑",
      projectId: "p",
      modelSelection: selection,
    });
    expect(read(V4_DRAFT_SCOPE_ROOT)?.taskGroupId).toBeUndefined();
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, { text: "继续输入" });
    expect(read(V4_DRAFT_SCOPE_ROOT)?.taskGroupId).toBeUndefined();
  });
  it("PD01/07 unsent catalog reference remains stable; old acceptance cannot clear next draft", () => {
    const scope = { clientNamespace: "desktop", hostId: "local", projectId: null };
    const a = ensurePendingTaskDraft(scope);
    expect(ensurePendingTaskDraft(scope).draftId).toBe(a.draftId);
    bindPendingTaskDraft(scope, a.draftId, "/task-a");
    expect(readPendingTaskDraft(scope)?.workspacePath).toBe("/task-a");
    completePendingTaskDraft(scope, "stale");
    expect(readPendingTaskDraft(scope)?.draftId).toBe(a.draftId);
    completePendingTaskDraft(scope, a.draftId);
    const b = ensurePendingTaskDraft(scope);
    expect(b.draftId).not.toBe(a.draftId);
    completePendingTaskDraft(scope, a.draftId);
    expect(readPendingTaskDraft(scope)?.draftId).toBe(b.draftId);
    expect(readV4ComposerDraft("/task-a", undefined, V4_DRAFT_SCOPE_ROOT, scope)).toBeNull();
  });
  it("PD03 project drafts in same directory remain independent; project can still be restored after changing primary directory", () => {
    const p = { clientNamespace: "desktop", hostId: "local", projectId: "p" };
    const q = { ...p, projectId: "q" };
    persistV4ComposerDraft(
      workspace,
      undefined,
      V4_DRAFT_SCOPE_ROOT,
      { text: "P", projectId: "p", mode: "yolo", modelSelection: selection },
      p,
    );
    persistV4ComposerDraft(
      workspace,
      undefined,
      V4_DRAFT_SCOPE_ROOT,
      { text: "Q", projectId: "q" },
      q,
    );
    expect(readV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, p)?.text).toBe("P");
    expect(
      readV4ComposerDraft("/new-root", undefined, V4_DRAFT_SCOPE_ROOT, p)?.modelSelection,
    ).toEqual(selection);
    clearV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, q);
    expect(readV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, p)?.text).toBe("P");
    expect(readV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, q)).toBeNull();
  });

  it("PD10 项目、任务、主机与客户端范围隔离，正式 session 保持原 key", () => {
    const task = { clientNamespace: "desktop", hostId: "local", projectId: null };
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, { text: "task" }, task);
    expect(readV4ComposerDraft("/another", undefined, V4_DRAFT_SCOPE_ROOT, task)?.text).toBe(
      "task",
    );
    for (const scope of [
      { ...task, projectId: "p" },
      { ...task, hostId: "remote" },
      { ...task, clientNamespace: "mobile" },
    ]) {
      expect(readV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, scope)).toBeNull();
    }
    expect(readV4ComposerDraft(workspace, undefined, "session-a", task)).toBeNull();
    persistV4ComposerDraft(workspace, undefined, "session-a", { text: "session" }, task);
    expect(read("session-a")?.text).toBe("session");
  });

  it("PD11 legacy draft is read only when project ownership matches; old content is not resurrected after explicit save", () => {
    const p = { clientNamespace: "desktop", hostId: "local", projectId: "p" };
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, {
      text: "legacy",
      projectId: "p",
    });
    expect(
      readV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, { ...p, projectId: "q" }),
    ).toBeNull();
    expect(readV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, p)?.text).toBe("legacy");
    persistV4ComposerDraft(
      workspace,
      undefined,
      V4_DRAFT_SCOPE_ROOT,
      { text: "", projectId: "p" },
      p,
    );
    expect(readV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, p)).toBeNull();
    expect(readV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT)?.text).toBe("legacy");
    expect(readV4ComposerDraft("/new-root", undefined, V4_DRAFT_SCOPE_ROOT, p)).toBeNull();
  });

  it("PD11 Switching primary directory after clearing a new-format draft cannot reclaim old text", () => {
    const scope = { clientNamespace: "desktop", hostId: "local", projectId: "p" };
    persistV4ComposerDraft("/old-root", undefined, V4_DRAFT_SCOPE_ROOT, {
      text: "legacy",
      projectId: "p",
    });
    persistV4ComposerDraft("/new-root", undefined, V4_DRAFT_SCOPE_ROOT, { text: "new" }, scope);
    clearV4ComposerDraft("/new-root", undefined, V4_DRAFT_SCOPE_ROOT, scope);
    expect(readV4ComposerDraft("/old-root", undefined, V4_DRAFT_SCOPE_ROOT, scope)).toBeNull();
  });

  it.each(["", " \n\t"])("TD01 Empty body %j is not written to disk due to config or metadata", (text) => {
    const write = vi.spyOn(storage, "setItem");
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, {
      text,
      mode: "yolo",
      modelSelection: selection,
      editorStateJson: "{}",
      projectId: "project",
      taskGroupId: "group",
    });
    expect(read(V4_DRAFT_SCOPE_ROOT)).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("TD04 Record is removed after deleting to empty, preserving text drafts of other sessions", () => {
    persistV4ComposerDraft(workspace, undefined, "other", { text: "keep", mode: "build" });
    persistV4ComposerDraft(workspace, undefined, "session-a", { text: "draft", mode: "yolo" });
    persistV4ComposerDraft(workspace, undefined, "session-a", { text: " ", mode: "yolo" });
    expect(read()).toBeNull();
    expect(read("other")?.text).toBe("keep");
  });

  it("CS08 Reads do not write to disk; explicit writes clean up old blank records while preserving drafts with text", () => {
    const key = getV4ComposerDraftStorageKey(workspace);
    storage.setItem(
      key,
      JSON.stringify({
        version: 1,
        scopes: {
          __draft__: { text: "", mode: "yolo", modelSelection: selection, updatedAt: 1 },
          other: { text: "keep", mode: "build", updatedAt: 2 },
        },
      }),
    );
    const write = vi.spyOn(storage, "setItem");
    const remove = vi.spyOn(storage, "removeItem");
    expect(read(V4_DRAFT_SCOPE_ROOT)).toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, { text: "" });
    expect(JSON.parse(storage.getItem(key)!).scopes.__draft__).toBeUndefined();
    expect(read("other")?.text).toBe("keep");
  });

  it("Group placement is preserved independently without loss when switching projects or editing text; copies are not retained after promotion", () => {
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, {
      text: "draft",
      taskGroupId: "group-a",
      projectId: "p",
    });
    const captured = read(V4_DRAFT_SCOPE_ROOT)?.taskGroupId;
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, {
      text: "hello",
      projectId: "p2",
    });
    expect(read(V4_DRAFT_SCOPE_ROOT)?.taskGroupId).toBe("group-a");
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, {
      text: "draft",
      taskGroupId: "group-b",
    });
    expect(captured).toBe("group-a");
    persistV4ComposerDraft(workspace, undefined, "real-task", {
      text: "draft",
      taskGroupId: "group-a",
    });
    expect(read("real-task")?.taskGroupId).toBeUndefined();
  });
  it("Project ownership is preserved across text drafts and body/model updates; explicit unclassified and promotion cleanups take effect", () => {
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, {
      text: "draft",
      projectId: "p",
    });
    expect(read(V4_DRAFT_SCOPE_ROOT)?.projectId).toBe("p");
    persistV4ComposerDraft(workspace, undefined, "promoted", { text: "sent", projectId: "p" });
    expect(read("promoted")?.projectId).toBeUndefined();
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, {
      text: "new text",
      mode: "build",
      modelSelection: selection,
    });
    expect(read(V4_DRAFT_SCOPE_ROOT)?.projectId).toBe("p");
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, {
      text: "draft",
      projectId: null,
    });
    expect(read(V4_DRAFT_SCOPE_ROOT)?.projectId).toBeNull();
    clearV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT);
    expect(read(V4_DRAFT_SCOPE_ROOT)).toBeNull();
  });
  it("旧事件消费字段与初始化标记不再参与文字恢复", () => {
    storage.setItem(
      getV4ComposerDraftStorageKey(workspace),
      JSON.stringify({
        version: 1,
        scopes: {
          "session-a": {
            text: "keep",
            mode: "build",
            initializeFromNewTask: true,
            lastPermissionGrantId: "old",
            lastPlanTransitionId: "old",
            updatedAt: 1,
          },
        },
      }),
    );
    expect(read()).toEqual({ text: "keep", mode: "build", planEnabled: false, updatedAt: 1 });
  });
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", { localStorage: storage });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Text drafts preserve initialized empty selections", () => {
    persistV4ComposerDraft(workspace, undefined, "session-a", { text: "draft", mode: "build" });
    expect(read()).toMatchObject({ text: "draft", mode: "build" });
    expect(read()?.modelSelection).toBeUndefined();
  });

  it("Clearing body after sending also removes persistent config", () => {
    const draft = { text: "prompt", mode: "plan" as const, modelSelection: selection };
    persistV4ComposerDraft(workspace, undefined, "session-a", draft);
    persistV4ComposerDraft(workspace, undefined, "session-a", { ...draft, text: "" });
    expect(read()).toBeNull();
  });

  it("Identical paths with different remotes are isolated from Root/Session scopes", () => {
    persistV4ComposerDraft(workspace, "remote-a", V4_DRAFT_SCOPE_ROOT, {
      text: "draft",
      mode: "edit",
    });
    persistV4ComposerDraft(workspace, "remote-b", V4_DRAFT_SCOPE_ROOT, {
      text: "draft",
      mode: "plan",
    });
    persistV4ComposerDraft(workspace, "remote-a", "session-a", { text: "draft", mode: "yolo" });
    expect(readV4ComposerDraft("/other-path", "remote-a", V4_DRAFT_SCOPE_ROOT)?.mode).toBe("edit");
    expect(readV4ComposerDraft(workspace, "remote-b", V4_DRAFT_SCOPE_ROOT)).toMatchObject({
      mode: "build",
      planEnabled: true,
    });
    expect(readV4ComposerDraft(workspace, "remote-a", "session-a")?.mode).toBe("yolo");
    expect(read()).toBeNull();
  });

  it("Cold-start initialization of Root scope preserves existing Session scopes", () => {
    persistV4ComposerDraft(workspace, undefined, "session-a", {
      text: "draft",
      mode: "edit",
      modelSelection: {
        providerId: "e2e-deepseek",
        modelId: "deepseek-v4-flash",
        options: { reasoningLevel: "max" },
      },
    });
    persistV4ComposerDraft(workspace, undefined, V4_DRAFT_SCOPE_ROOT, {
      text: "draft",
      mode: "build",
      modelSelection: {
        providerId: "e2e-deepseek",
        modelId: "deepseek-v4-flash",
        options: { reasoningLevel: "max" },
      },
    });
    expect(read("session-a")).toMatchObject({ mode: "edit" });
    expect(read(V4_DRAFT_SCOPE_ROOT)).toMatchObject({ mode: "build" });
  });

  it("Compatible with legacy text drafts; isolates corrupted current selections by leaf", () => {
    storage.setItem(
      getV4ComposerDraftStorageKey(workspace),
      JSON.stringify({
        version: 1,
        scopes: {
          old: { text: "old text", editorStateJson: "{}", updatedAt: 1 },
          "session-a": {
            text: "keep",
            mode: "edit",
            modelSelection: { ...selection, options: 7 },
            updatedAt: 2,
          },
          invalid: { text: 42, mode: "edit", updatedAt: 3 },
        },
      }),
    );
    expect(read("old")).toEqual({ text: "old text", editorStateJson: "{}", updatedAt: 1 });
    expect(read()?.modelSelection).toEqual({
      providerId: selection.providerId,
      modelId: selection.modelId,
    });
    expect(read()?.mode).toBe("edit");
    expect(read("invalid")).toBeNull();
  });

  it("长期使用的模型选择不会因 scope 数量被静默淘汰", () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => ++now);
    for (let index = 0; index < 501; index++) {
      persistV4ComposerDraft(workspace, undefined, `scope-${index}`, {
        text: "draft",
        mode: "build",
      });
      if (index === 50 || index === 499) expect(read("scope-0")).not.toBeNull();
    }
    expect(read("scope-0")).not.toBeNull();
    expect(read("scope-1")?.mode).toBe("build");
    expect(read("scope-500")?.mode).toBe("build");
  });

  it("存储不可读不能让 Composer 崩溃", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => read()).not.toThrow();
    expect(read()).toBeNull();
  });
});
