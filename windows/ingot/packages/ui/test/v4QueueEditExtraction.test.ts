import { describe, expect, it, vi } from "vitest";
import type { ConversationSnapshot } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  applyExternalTextInsertRequestToComposer,
  applyComposerRestoreRequestToComposer,
  restorePersistedComposerDraftIntoInput,
  type ComposerRestoreRequest,
} from "@/v4/ConversationComposer.js";
import {
  resolveQueuedComposerRestore,
  shouldRestoreQueuedComposerFromAck,
} from "@/v4/SessionPane.js";

function makeSnapshot(): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId: "session-1",
    logEpoch: "epoch-1",
    seq: 1,
    revision: 7,
    control: {
      phase: "running",
      sessionEnded: false,
      canStop: true,
      stopState: "stoppable",
      stopTargetKind: "primaryTurn",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: {
      fork: { allowed: true },
      compact: { allowed: true },
      switchModelConfig: { allowed: true },
      setFollowupMode: { allowed: true },
      queueEdit: { allowed: true },
      sendQueuedNow: { allowed: true },
      pauseGoal: { allowed: false, reasonCode: "noGoalToPause" },
      resumeGoal: { allowed: false, reasonCode: "noGoalToResume" },
    },
    inputRouting: { mode: "enqueue" },
    meta: { title: "Session", titleSource: "generated" },
    config: { provider: "", model: "", thought: "", followupMode: "queue", mode: "build" },
    usage: {
      contextWindow: null,
      cumulative: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    queue: {
      autoDrain: true,
      items: [
        {
          queueItemId: "q-1",
          kind: "sendText",
          text: "排队原文",
          sourceCommandId: "cmd-q1",
          clientId: "cli",
          attachments: [
            { ref: "ref-b", fileName: "b.png", mime: "image/png", bytes: 2 },
            { ref: "ref-a", fileName: "a.txt", mime: "text/plain", bytes: 1 },
          ],
          delivery: { requested: "queue", admitted: "queue" },
          order: { admissionSeq: 1, queuePosition: 0 },
          steer: { state: "notRequested" },
          dispatch: { state: "queued" },
          admittedAt: 1,
        },
      ],
    },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    rows: { window: [], totalCount: 0, firstRowId: null },
  };
}

describe("v4 queue edit extraction", () => {
  it("Workspace Plugins页重挂载时从SharedDraft恢复Structures化 mention", () => {
    const mention = {
      id: "plugin:document-skills@official",
      category: "plugins" as const,
      label: "文档技能",
      value: "document-skills@official",
      markdown: "[@文档技能](plugin://document-skills@official)",
      data: { pluginId: "document-skills@official" },
    };
    const inputApi = {
      getMarkdown: vi.fn(() => "unused"),
      setEditorStateJson: vi.fn(),
      setMention: vi.fn(),
      setText: vi.fn(),
    };
    const text = `${mention.markdown} 整理Documentation`;

    expect(
      restorePersistedComposerDraftIntoInput({
        draft: { text, mention, updatedAt: 1 },
        inputApi,
      }),
    ).toBe(text);
    expect(inputApi.setMention).toHaveBeenCalledWith(mention, " 整理Documentation");
    expect(inputApi.setText).not.toHaveBeenCalled();
  });

  it("商店试用把 canonical Prefix恢复为Structures化 Plugin mention", () => {
    const mention = {
      id: "plugin:demo@mkt",
      category: "plugins" as const,
      label: "Demo",
      value: "demo@mkt",
      markdown: "[@Demo](plugin://demo@mkt)",
      data: {
        pluginId: "demo@mkt",
        icon: "https://cdn.example.com/demo.png",
      },
    };
    const inputApi = {
      setMention: vi.fn(),
      setText: vi.fn(),
    };
    const updateText = vi.fn();
    const requestFocus = vi.fn();
    const scheduleDraftPersist = vi.fn();
    const text = `${mention.markdown} Diagnose this workspace`;

    expect(
      applyExternalTextInsertRequestToComposer({
        appliedRequestId: null,
        inputApi,
        request: { requestId: 7, text, mention },
        requestFocus,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBe(7);
    expect(inputApi.setMention).toHaveBeenCalledWith(mention, " Diagnose this workspace");
    expect(inputApi.setText).not.toHaveBeenCalled();
    expect(updateText).toHaveBeenCalledWith(text);
    expect(scheduleDraftPersist).toHaveBeenCalledTimes(1);
    expect(requestFocus).toHaveBeenCalledTimes(1);
  });

  it("PluginsInstallCompleted后把唯One chip 前置到EditorCurrentBody而不回放Old prompt", () => {
    const mention = {
      id: "plugin:document-skills@cf-plugins-official",
      category: "plugins" as const,
      label: "文档技能",
      value: "document-skills@cf-plugins-official",
      markdown: "[@文档技能](plugin://document-skills@cf-plugins-official)",
      data: { pluginId: "document-skills@cf-plugins-official" },
    };
    const inputApi = {
      getMarkdown: vi.fn(() => `${mention.markdown} UserInstall期间Edit后的Body`),
      prependMentionIfMissing: vi.fn(() => true),
      setMention: vi.fn(),
      setText: vi.fn(),
    };
    const updateText = vi.fn();
    const requestFocus = vi.fn();
    const scheduleDraftPersist = vi.fn();

    expect(
      applyExternalTextInsertRequestToComposer({
        appliedRequestId: null,
        inputApi,
        request: {
          requestId: 8,
          text: mention.markdown,
          mention,
          mode: "prepend-if-missing",
        },
        requestFocus,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBe(8);
    expect(inputApi.prependMentionIfMissing).toHaveBeenCalledWith(mention);
    expect(updateText).toHaveBeenCalledWith(`${mention.markdown} UserInstall期间Edit后的Body`);
    expect(inputApi.setMention).not.toHaveBeenCalled();
    expect(inputApi.setText).not.toHaveBeenCalled();
  });

  it("CurrentDraft已有同One Plugin canonical Text时不重复插入 chip", () => {
    const mention = {
      id: "plugin:demo@mkt",
      category: "plugins" as const,
      label: "Demo",
      value: "demo@mkt",
      markdown: "[@Demo](plugin://demo@mkt)",
      data: { pluginId: "demo@mkt" },
    };
    const inputApi = {
      getMarkdown: vi.fn(() => "[@OldName](plugin://demo@mkt) CurrentBody"),
      prependMentionIfMissing: vi.fn(() => false),
      setMention: vi.fn(),
      setText: vi.fn(),
    };
    const updateText = vi.fn();

    expect(
      applyExternalTextInsertRequestToComposer({
        appliedRequestId: null,
        inputApi,
        request: {
          requestId: 9,
          text: mention.markdown,
          mention,
          mode: "prepend-if-missing",
        },
        requestFocus: vi.fn(),
        scheduleDraftPersist: vi.fn(),
        updateText,
      }),
    ).toBe(9);
    expect(inputApi.prependMentionIfMissing).toHaveBeenCalledWith(mention);
    expect(inputApi.setMention).not.toHaveBeenCalled();
    expect(updateText).not.toHaveBeenCalled();
  });

  it("PA158 撤回使用Queue项自身Permissions/Plan/Model，不借用Current Composer Configuration", () => {
    const snapshot = makeSnapshot();
    Object.assign(snapshot.queue.items[0]!, {
      mode: "yolo",
      planEnabled: false,
      modelSelection: {
        providerId: "provider",
        modelId: "model",
        options: { reasoningLevel: "high" },
      },
    });
    expect(resolveQueuedComposerRestore(snapshot, "q-1")?.config).toEqual({
      mode: "yolo",
      planEnabled: false,
      modelSelection: {
        providerId: "provider",
        modelId: "model",
        options: { reasoningLevel: "high" },
      },
    });
  });

  it("Old Highspeed Queue项撤回Edit时不得把临时 Provider 恢复到 Composer", () => {
    const snapshot = makeSnapshot();
    Object.assign(snapshot.queue.items[0]!, {
      highspeed: {
        schemaVersion: 1,
        cardId: "card-1",
        taskId: "session-1",
        provider: "bigmodel",
        model: "GLM-5.3",
        issuedAt: 1,
        expiresAt: Date.now() + 60_000,
      },
      mode: "yolo",
      modelSelection: {
        providerId: "account:bigmodel-highspeed-card",
        modelId: "GLM-5.3",
      },
    });

    expect(resolveQueuedComposerRestore(snapshot, "q-1")?.config).toEqual({ mode: "yolo" });
  });

  it("OldQueue项只带临时 Provider、不带卡Metadata时，撤回Edit同样不得恢复该 Provider", () => {
    const snapshot = makeSnapshot();
    Object.assign(snapshot.queue.items[0]!, {
      mode: "yolo",
      modelSelection: {
        providerId: "account:bigmodel-highspeed-card",
        modelId: "GLM-5.3",
      },
    });

    expect(resolveQueuedComposerRestore(snapshot, "q-1")?.config).toEqual({ mode: "yolo" });
  });

  it("提取CompleteInput并保持Attachment顺序，供权威Delete后恢复 composer", () => {
    expect(resolveQueuedComposerRestore(makeSnapshot(), "q-1")).toEqual({
      baseRevision: 7,
      queueItemId: "q-1",
      sourceCommandId: "cmd-q1",
      inputKind: "sendText",
      text: "排队原文",
      attachments: [
        { ref: "ref-b", fileName: "b.png", mime: "image/png", bytes: 2 },
        { ref: "ref-a", fileName: "a.txt", mime: "text/plain", bytes: 1 },
      ],
    });
    expect(resolveQueuedComposerRestore(makeSnapshot(), "missing")).toBeNull();
  });

  it("goal 恢复可见 slash Text，compact 明确剪枝", () => {
    const goal = makeSnapshot();
    goal.queue.items[0] = {
      ...goal.queue.items[0]!,
      kind: "sendGoalCommand",
      text: "修复登录",
    };
    expect(resolveQueuedComposerRestore(goal, "q-1")?.text).toBe("/goal 修复登录");

    const compact = makeSnapshot();
    compact.queue.items[0] = {
      ...compact.queue.items[0]!,
      kind: "compact",
      text: "/compact",
      attachments: [],
    };
    expect(resolveQueuedComposerRestore(compact, "q-1")).toBeNull();
  });

  it("只Allow accepted/duplicate 恢复，Other ACK 分支保持 composer 不变", () => {
    expect(shouldRestoreQueuedComposerFromAck("accepted")).toBe(true);
    expect(shouldRestoreQueuedComposerFromAck("duplicate")).toBe(true);
    expect(shouldRestoreQueuedComposerFromAck("noop")).toBe(false);
    expect(shouldRestoreQueuedComposerFromAck("stale")).toBe(false);
    expect(shouldRestoreQueuedComposerFromAck("rejected")).toBe(false);
    expect(shouldRestoreQueuedComposerFromAck("failed")).toBe(false);
  });

  it("只在Bind session/workspace 的空 composer 幂等恢复TextCharacter与Attachment", () => {
    const request: ComposerRestoreRequest = {
      requestId: 1,
      sessionId: "session-1",
      workspaceKey: "remote:ssh:host:/workspace",
      inputKind: "sendText",
      text: "排队原文",
      attachments: [{ ref: "ref-1", fileName: "a.png", mime: "image/png", bytes: 1 }],
      config: { mode: "yolo", planEnabled: false },
    };
    const inputApi = {
      focus: vi.fn(),
      setText: vi.fn(),
    };
    const updateText = vi.fn();
    const requestFocus = vi.fn();
    const scheduleDraftPersist = vi.fn();
    const restoreSessionOwnedAttachments = vi.fn(() => true);
    const restoreDraftConfig = vi.fn();

    expect(
      applyComposerRestoreRequestToComposer({
        appliedRequestId: null,
        currentSessionId: "session-1",
        currentWorkspaceKey: "remote:ssh:host:/workspace",
        hasDraftContent: false,
        inputApi,
        request,
        requestFocus,
        restoreSessionOwnedAttachments,
        restoreDraftConfig,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBe(1);
    expect(inputApi.setText).toHaveBeenCalledWith("排队原文");
    expect(updateText).toHaveBeenCalledWith("排队原文");
    expect(requestFocus).toHaveBeenCalledTimes(1);
    expect(scheduleDraftPersist).toHaveBeenCalledTimes(1);
    expect(restoreSessionOwnedAttachments).toHaveBeenCalledWith(request.attachments);

    expect(
      applyComposerRestoreRequestToComposer({
        appliedRequestId: 1,
        currentSessionId: "session-1",
        currentWorkspaceKey: "remote:ssh:host:/workspace",
        hasDraftContent: false,
        inputApi,
        request,
        requestFocus,
        restoreSessionOwnedAttachments,
        restoreDraftConfig,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBe(1);
    expect(inputApi.setText).toHaveBeenCalledTimes(1);
    expect(restoreSessionOwnedAttachments).toHaveBeenCalledTimes(1);

    expect(
      applyComposerRestoreRequestToComposer({
        appliedRequestId: null,
        currentSessionId: "session-other",
        currentWorkspaceKey: "remote:ssh:host:/workspace",
        hasDraftContent: false,
        inputApi,
        request,
        requestFocus,
        restoreSessionOwnedAttachments,
        restoreDraftConfig,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBeNull();
    expect(
      applyComposerRestoreRequestToComposer({
        appliedRequestId: null,
        currentSessionId: "session-1",
        currentWorkspaceKey: "remote:ssh:host:/workspace",
        hasDraftContent: true,
        inputApi,
        request,
        requestFocus,
        restoreSessionOwnedAttachments,
        restoreDraftConfig,
        scheduleDraftPersist,
        updateText,
      }),
    ).toBeNull();
    expect(inputApi.setText).toHaveBeenCalledTimes(1);
    expect(restoreDraftConfig).toHaveBeenCalledExactlyOnceWith(request.config);
  });
});
