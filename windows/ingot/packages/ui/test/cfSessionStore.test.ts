import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_MODEL_PROVIDER_IDS,
  buildCustomSupplierKey,
  type CfError,
  type CfConfigOption,
  type CfPermissionRequest,
  type CfTaskMeta,
} from "@origin-ai/cf-shared";
import {
  DEFAULT_TASK_UI_STATE,
  DEFAULT_TASK_RUNTIME_STATE,
  getTaskRuntimeState,
  getTaskUnreadIndicator,
  getTaskUiState,
  getWorkspaceDisplayedTaskState,
  useCfSessionStore,
} from "../src/store/cfSessionStore.js";
import { canGoForward } from "../src/lib/taskNavigationHistory.js";
import { LAST_SELECTED_AGENT_PROVIDER_STORAGE_KEY } from "../src/lib/cfProviderPreference.js";
import { encodeCustomModelValue } from "../src/lib/cfCustomModelValue.js";

function createStorageMock(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));

  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

function createTaskMeta(overrides: Partial<CfTaskMeta> = {}): CfTaskMeta {
  return {
    taskId: "task-1",
    traceId: "trace-1",
    title: "Fix task deletion linkage",
    workspacePath: "/tmp/workspace-delete",
    createdAt: 1,
    updatedAt: 1,
    mode: "default",
    provider: "codex",
    ...overrides,
  };
}

function createPermissionRequest(
  overrides: Partial<CfPermissionRequest> = {},
): CfPermissionRequest {
  return {
    type: "permission_request",
    taskId: "task-1",
    traceId: "trace-1",
    requestId: "perm-1",
    description: "允许执行命令",
    kind: "execute",
    options: [
      {
        optionId: "allow-once",
        kind: "allow_once",
        name: "允许一次",
      },
    ],
    raw: { toolCallId: "tool-1" },
    ...overrides,
  };
}

function createCfError(overrides: Partial<CfError> = {}): CfError {
  return {
    code: "SEND_FAILED",
    message: "命令执行失败",
    traceId: "trace-error-1",
    taskId: "task-1",
    ...overrides,
  };
}

function createModelConfigOption(currentValue: string): CfConfigOption {
  return {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue,
    options: [{ value: currentValue, name: currentValue }],
  };
}

function createModeConfigOption(currentValue: string): CfConfigOption {
  return {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue,
    options: [
      { value: "build", name: "Build" },
      { value: "plan", name: "Plan" },
      { value: "yolo", name: "Yolo" },
    ],
  };
}

function createThoughtConfigOption(currentValue: string): CfConfigOption {
  return {
    id: "thought_level",
    name: "Thought Level",
    category: "thought_level",
    type: "select",
    currentValue,
    options: [
      { value: "max", name: "Max" },
      { value: "high", name: "High" },
      { value: "nothink", name: "No Think" },
    ],
  };
}

function readModelConfigValue(
  options: readonly CfConfigOption[] | null | undefined,
): string | null {
  const modelOption = options?.find(
    (option) => option.category === "model" && option.type === "select",
  );
  return typeof modelOption?.currentValue === "string" ? modelOption.currentValue : null;
}

function readModeConfigOption(options: readonly CfConfigOption[] | null | undefined) {
  return options?.find((option) => option.category === "mode" && option.type === "select") ?? null;
}

describe("useCfSessionStore provider preference", () => {
  beforeEach(() => {
    useCfSessionStore.setState((state) => ({
      ...state,
      workspaces: {},
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("setConfigOptions 会把空 thought_level 归一到第一个合法选项", () => {
    const workspacePath = "/tmp/workspace-thought-normalize";
    useCfSessionStore.getState().setConfigOptions(workspacePath, [
      {
        id: "thought_level",
        name: "Thought Level",
        category: "thought_level",
        type: "select",
        currentValue: "",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
        ],
      },
    ]);

    expect(
      useCfSessionStore
        .getState()
        .getWorkspaceState(workspacePath)
        .configOptions?.find((option) => option.id === "thought_level")?.currentValue,
    ).toBe("low");
  });

  it.each([
    [BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan, "glm-5.2-pro"],
    [BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan, "GLM-5.2"],
    ["default-glm", "glm-0606[1m]"],
  ])("setConfigOptions preserves high thought intensity for %s/%s", (providerId, modelId) => {
    const workspacePath = `/tmp/workspace-hide-high-${providerId}-${modelId}`;
    useCfSessionStore.getState().setConfigOptions(workspacePath, [
      createModelConfigOption(`${providerId}/${modelId}`),
      {
        id: "thought_level",
        name: "Thought Level",
        category: "thought_level",
        type: "select",
        currentValue: "high",
        options: [
          { value: "max", name: "Max" },
          { value: "high", name: "High" },
          { value: "nothink", name: "No Thinking" },
        ],
      },
    ]);

    const thoughtOption = useCfSessionStore
      .getState()
      .getWorkspaceState(workspacePath)
      .configOptions?.find((option) => option.id === "thought_level");

    expect(thoughtOption?.options?.map((option) => option.value)).toEqual([
      "max",
      "high",
      "nothink",
    ]);
    expect(thoughtOption?.currentValue).toBe("high");
  });

  it("setConfigOptions preserves high thought intensity for provider-less glm-date models", () => {
    const workspacePath = "/tmp/workspace-hide-high-plain-glm-date";
    useCfSessionStore.getState().setConfigOptions(workspacePath, [
      createModelConfigOption("glm-0606[1m]"),
      {
        id: "thought_level",
        name: "Thought Level",
        category: "thought_level",
        type: "select",
        currentValue: "high",
        options: [
          { value: "max", name: "Max" },
          { value: "high", name: "High" },
          { value: "nothink", name: "No Thinking" },
        ],
      },
    ]);

    const thoughtOption = useCfSessionStore
      .getState()
      .getWorkspaceState(workspacePath)
      .configOptions?.find((option) => option.id === "thought_level");

    expect(thoughtOption?.options?.map((option) => option.value)).toEqual([
      "max",
      "high",
      "nothink",
    ]);
    expect(thoughtOption?.currentValue).toBe("high");
  });

  it("bindRuntimeProvider normalizes old providers without overwriting supplier or modifying local preferences", () => {
    const storage = createStorageMock();
    vi.stubGlobal("window", { localStorage: storage });
    const workspacePath = "/tmp/workspace-runtime-bind";
    const customSupplierKey = buildCustomSupplierKey("provider-a");

    useCfSessionStore.getState().startDraft(workspacePath, "codex");
    useCfSessionStore.getState().setModelSelectionResolution(workspacePath, {
      selectedSupplierKey: customSupplierKey,
      isGhostSupplier: false,
      supplierMismatchReason: null,
    });

    useCfSessionStore.getState().bindRuntimeProvider(workspacePath, "opencode");

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(storage.getItem(LAST_SELECTED_AGENT_PROVIDER_STORAGE_KEY)).toBe("glm");
    expect(workspaceState.selectedProvider).toBe("glm");
    expect(workspaceState.selectedSupplierKey).toBe(customSupplierKey);
  });

  it("composer text insertion requests are isolated by workspaceIdentity and can only be cleaned up by the corresponding version", () => {
    const workspacePath = "/tmp/workspace-composer-prefill";
    const workspaceIdentityA = "ssh://user@host-a:/tmp/workspace-composer-prefill";
    const workspaceIdentityB = "ssh://user@host-b:/tmp/workspace-composer-prefill";
    const store = useCfSessionStore.getState();

    expect(store.requestComposerTextInsert(workspacePath, "first", workspaceIdentityA)).toBe(1);
    expect(
      store.requestComposerTextInsert(workspacePath, "second", workspaceIdentityA, {
        id: "plugin:demo@mkt",
        category: "plugins",
        label: "Demo",
        value: "demo@mkt",
        markdown: "[@Demo](plugin://demo@mkt)",
        data: {
          pluginId: "demo@mkt",
          icon: "https://cdn.example.com/demo.png",
        },
      }),
    ).toBe(2);
    store.requestComposerTextInsert(workspacePath, "isolated", workspaceIdentityB);
    store.requestComposerTextInsert(
      workspacePath,
      "[@Demo](plugin://demo@mkt)",
      workspaceIdentityA,
      {
        id: "plugin:demo@mkt",
        category: "plugins",
        label: "Demo",
        value: "demo@mkt",
        markdown: "[@Demo](plugin://demo@mkt)",
        data: { pluginId: "demo@mkt" },
      },
      "prepend-if-missing",
    );

    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentityA)
        .composerTextInsertRequest,
    ).toEqual({
      requestId: 3,
      text: "[@Demo](plugin://demo@mkt)",
      mention: {
        id: "plugin:demo@mkt",
        category: "plugins",
        label: "Demo",
        value: "demo@mkt",
        markdown: "[@Demo](plugin://demo@mkt)",
        data: {
          pluginId: "demo@mkt",
        },
      },
      mode: "prepend-if-missing",
    });
    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentityB)
        .composerTextInsertRequest,
    ).toEqual({ requestId: 1, text: "isolated" });

    useCfSessionStore
      .getState()
      .clearComposerTextInsertRequest(workspacePath, 1, workspaceIdentityA);
    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentityA)
        .composerTextInsertRequest,
    ).toEqual(expect.objectContaining({ requestId: 3, mode: "prepend-if-missing" }));

    useCfSessionStore
      .getState()
      .clearComposerTextInsertRequest(workspacePath, 2, workspaceIdentityA);
    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentityA)
        .composerTextInsertRequest,
    ).toEqual(expect.objectContaining({ requestId: 3, mode: "prepend-if-missing" }));

    useCfSessionStore
      .getState()
      .clearComposerTextInsertRequest(workspacePath, 3, workspaceIdentityA);
    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentityA)
        .composerTextInsertRequest,
    ).toBeNull();
  });

  it("Timeline bottom-reached requests increment even if the target task is not switched, and can only be cleaned up by the corresponding version", () => {
    const workspacePath = "/tmp/workspace-timeline-bottom";
    const workspaceIdentity = "ssh://user@host:/tmp/workspace-timeline-bottom";
    const store = useCfSessionStore.getState();

    expect(store.requestTimelineBottom(workspacePath, "task-1", workspaceIdentity)).toBe(1);
    expect(store.requestTimelineBottom(workspacePath, "task-1", workspaceIdentity)).toBe(2);
    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
        .timelineBottomRequest,
    ).toEqual({ requestId: 2, taskId: "task-1" });

    store.clearTimelineBottomRequest(workspacePath, 1, workspaceIdentity);
    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
        .timelineBottomRequest,
    ).toEqual({ requestId: 2, taskId: "task-1" });

    store.clearTimelineBottomRequest(workspacePath, 2, workspaceIdentity);
    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
        .timelineBottomRequest,
    ).toBeNull();
  });

  it("bindRuntimeProvider should not overwrite supplier between different workspaceIdentities under the same path", () => {
    const workspacePath = "/tmp/workspace-runtime-identity";
    const workspaceIdentityA = "ssh://user@host-a:/tmp/workspace-runtime-identity";
    const workspaceIdentityB = "ssh://user@host-b:/tmp/workspace-runtime-identity";
    const customSupplierKeyA = buildCustomSupplierKey("provider-a");
    const customSupplierKeyB = buildCustomSupplierKey("provider-b");

    useCfSessionStore.getState().startDraft(workspacePath, "claude", workspaceIdentityA);
    useCfSessionStore.getState().setModelSelectionResolution(
      workspacePath,
      {
        selectedSupplierKey: customSupplierKeyA,
        isGhostSupplier: false,
        supplierMismatchReason: null,
      },
      workspaceIdentityA,
    );
    useCfSessionStore
      .getState()
      .bindRuntimeProvider(workspacePath, "claude", workspaceIdentityA);

    useCfSessionStore.getState().startDraft(workspacePath, "opencode", workspaceIdentityB);
    useCfSessionStore.getState().setModelSelectionResolution(
      workspacePath,
      {
        selectedSupplierKey: customSupplierKeyB,
        isGhostSupplier: false,
        supplierMismatchReason: null,
      },
      workspaceIdentityB,
    );
    useCfSessionStore
      .getState()
      .bindRuntimeProvider(workspacePath, "opencode", workspaceIdentityB);

    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentityA)
        .selectedSupplierKey,
    ).toBe(customSupplierKeyA);
    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentityB)
        .selectedSupplierKey,
    ).toBe(customSupplierKeyB);
  });

  it("同一 remote workspace overlay 连续读取时应复用同一个快照引用", () => {
    const workspacePath = "/tmp/workspace-identity-overlay-snapshot";
    const workspaceIdentity = "ssh://user@host:/tmp/workspace-identity-overlay-snapshot";

    useCfSessionStore.getState().startDraft(workspacePath, "opencode");

    const firstSnapshot = useCfSessionStore
      .getState()
      .getWorkspaceState(workspacePath, workspaceIdentity);
    const secondSnapshot = useCfSessionStore
      .getState()
      .getWorkspaceState(workspacePath, workspaceIdentity);

    expect(firstSnapshot.selectedProvider).toBe("glm");
    expect(firstSnapshot).toBe(secondSnapshot);

    useCfSessionStore.getState().setTaskUnreadIndicator(workspacePath, "task-1", true);

    const thirdSnapshot = useCfSessionStore
      .getState()
      .getWorkspaceState(workspacePath, workspaceIdentity);

    expect(thirdSnapshot).not.toBe(firstSnapshot);
    expect(thirdSnapshot.selectedProvider).toBe("glm");
    expect(thirdSnapshot.taskUnreadByTaskId["task-1"]).toBe(true);
  });

  it("Closing grouped drafts only clears in-memory groups for the current identity, without rebuilding drafts or polluting the same path", () => {
    const store = useCfSessionStore.getState();
    const path = "/group-draft";
    const identity = "remote:server:other:/group-draft";
    store.startDraft(path, undefined, undefined, { projectId: "local", taskGroupId: "local-g" });
    store.startDraft(path, undefined, identity, { projectId: "remote", taskGroupId: "remote-g" });
    const local = useCfSessionStore.getState().getWorkspaceState(path);
    const remote = useCfSessionStore.getState().getWorkspaceState(path, identity);
    store.clearDraftTaskGroup(path, identity);
    expect(useCfSessionStore.getState().getWorkspaceState(path)).toBe(local);
    expect(useCfSessionStore.getState().getWorkspaceState(path, identity)).toEqual({
      ...remote,
      draftTaskGroupId: undefined,
    });
  });

  it("Switching draft items under the same cwd only rebuilds warmed-up instances; submitted tasks retain ownership", () => {
    const store = useCfSessionStore.getState();
    const path = "/project-draft";
    store.startDraft(path, undefined, undefined, { projectId: "a" });
    const first = useCfSessionStore.getState().getWorkspaceState(path);
    expect(first.draftProjectId).toBe("a");
    store.startDraft(path, undefined, undefined, { projectId: "a" });
    expect(
      useCfSessionStore.getState().getWorkspaceState(path).draftRuntimeInvalidationVersion,
    ).toBe(first.draftRuntimeInvalidationVersion);
    store.startDraft(path, undefined, undefined, { projectId: "b" });
    expect(useCfSessionStore.getState().getWorkspaceState(path)).toMatchObject({
      draftProjectId: "b",
      draftRuntimeInvalidationVersion: first.draftRuntimeInvalidationVersion + 1,
    });
    store.startDraft(path, undefined, undefined, { projectId: null });
    expect(useCfSessionStore.getState().getWorkspaceState(path).draftProjectId).toBeNull();
  });

  it("workspaceIdentity overlay should prioritize reading transient state from the identity bucket", () => {
    const workspacePath = "/tmp/workspace-remote-transient-state";
    const workspaceIdentity =
      "remote:ssh:localhost:2222:root:/tmp/workspace-remote-transient-state";
    const taskId = "task-remote-transient";
    const identityOptions = [createModelConfigOption("glm-identity")];
    const pathOptions = [createModelConfigOption("glm-path")];

    useCfSessionStore.getState().startDraft(workspacePath, undefined, workspaceIdentity);
    useCfSessionStore.getState().startDraft(workspacePath, undefined, workspaceIdentity);
    useCfSessionStore.getState().bumpTaskListVersion(workspacePath, workspaceIdentity);
    useCfSessionStore.getState().bumpTaskListVersion(workspacePath, workspaceIdentity);
    useCfSessionStore
      .getState()
      .setTaskConfigOptions(workspacePath, taskId, identityOptions, workspaceIdentity);
    useCfSessionStore
      .getState()
      .setTaskUnreadIndicator(workspacePath, taskId, true, workspaceIdentity);

    useCfSessionStore.getState().startDraft(workspacePath);
    useCfSessionStore.getState().bumpTaskListVersion(workspacePath);
    useCfSessionStore.getState().setTaskConfigOptions(workspacePath, taskId, pathOptions);
    useCfSessionStore.getState().setTaskUnreadIndicator(workspacePath, taskId, false);

    const workspaceState = useCfSessionStore
      .getState()
      .getWorkspaceState(workspacePath, workspaceIdentity);

    expect(readModelConfigValue(workspaceState.taskConfigOptionsByTaskId[taskId])).toBe(
      "glm-identity",
    );
    expect(workspaceState.taskUnreadByTaskId[taskId]).toBe(true);
    expect(workspaceState.taskListVersion).toBe(2);
    expect(workspaceState.draftFocusVersion).toBe(2);
  });

  it("startDraft should not reset custom supplier to native when passed the same provider", () => {
    const workspacePath = "/tmp/workspace-draft-same-provider";
    const customSupplierKey = buildCustomSupplierKey("provider-a");

    useCfSessionStore.getState().startDraft(workspacePath, "claude");
    useCfSessionStore.getState().setModelSelectionResolution(workspacePath, {
      selectedSupplierKey: customSupplierKey,
      isGhostSupplier: false,
      supplierMismatchReason: null,
    });

    useCfSessionStore.getState().startDraft(workspacePath, "claude");

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(workspaceState.selectedProvider).toBe("glm");
    expect(workspaceState.selectedSupplierKey).toBe(customSupplierKey);
  });

  it("startDraft increments draft focus version so the input box can focus immediately after creating a task", () => {
    const storage = createStorageMock();
    vi.stubGlobal("window", { localStorage: storage });

    const workspacePath = "/tmp/workspace-focus";
    expect(useCfSessionStore.getState().getWorkspaceState(workspacePath).draftFocusVersion).toBe(
      0,
    );

    useCfSessionStore.getState().startDraft(workspacePath);
    expect(useCfSessionStore.getState().getWorkspaceState(workspacePath).draftFocusVersion).toBe(
      1,
    );

    useCfSessionStore.getState().startDraft(workspacePath, "opencode");
    expect(useCfSessionStore.getState().getWorkspaceState(workspacePath).draftFocusVersion).toBe(
      2,
    );
  });

  it("startDraft inherits full input box configuration when created from active task with the same provider passed through", () => {
    const workspacePath = "/tmp/workspace-new-task-inherit-active-config";
    const taskId = "task-provider-a";
    const taskModel = "provider-a/model-a";
    const workspaceModel = "account:bigmodel-individual-coding-plan/GLM-5.2";

    useCfSessionStore
      .getState()
      .setConfigOptions(workspacePath, [createModelConfigOption(workspaceModel)]);
    useCfSessionStore.getState().setActiveTaskId(workspacePath, taskId);
    useCfSessionStore
      .getState()
      .setTaskConfigOptions(workspacePath, taskId, [
        createModelConfigOption(taskModel),
        createModeConfigOption("yolo"),
        createThoughtConfigOption("max"),
      ]);

    useCfSessionStore.getState().startDraft(workspacePath, "glm");

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(workspaceState.activeTaskId).toBeNull();
    expect(readModelConfigValue(workspaceState.configOptions)).toBe(taskModel);
    expect(readModeConfigOption(workspaceState.configOptions)?.currentValue).toBe("yolo");
    expect(
      workspaceState.configOptions?.find((option) => option.category === "thought_level")
        ?.currentValue,
    ).toBe("max");
  });

  it("草稿态重复点击新建任务时不应清空 slashCommands", () => {
    const workspacePath = "/tmp/workspace-draft-slash-commands";
    const slashCommands = [
      { name: "status", description: "查看当前状态" },
      { name: "review", description: "发起代码审查" },
    ];

    useCfSessionStore.getState().setSlashCommands(workspacePath, slashCommands);

    useCfSessionStore.getState().startDraft(workspacePath);
    expect(useCfSessionStore.getState().getWorkspaceState(workspacePath).slashCommands).toEqual(
      slashCommands,
    );

    useCfSessionStore.getState().setActiveTaskId(workspacePath, "task-from-list");
    useCfSessionStore.getState().startDraft(workspacePath);
    expect(useCfSessionStore.getState().getWorkspaceState(workspacePath).slashCommands).toEqual(
      [],
    );
  });

  it("workspaceIdentity isolates workspace-level commands, initialization, and model switching states", () => {
    const workspacePath = "/tmp/workspace-same-path-state";
    const identityA = "ssh://host-a/tmp/workspace-same-path-state";
    const identityB = "ssh://host-b/tmp/workspace-same-path-state";
    const slashCommands = [{ name: "review", description: "发起代码审查" }];

    useCfSessionStore.getState().setSlashCommands(workspacePath, slashCommands, identityA);
    useCfSessionStore.getState().setWorkspaceInitState(workspacePath, "ready", null, identityA);
    useCfSessionStore
      .getState()
      .startModelSwitch(workspacePath, "switch-a", "settingModel", identityA);

    const workspaceStateA = useCfSessionStore
      .getState()
      .getWorkspaceState(workspacePath, identityA);
    const workspaceStateB = useCfSessionStore
      .getState()
      .getWorkspaceState(workspacePath, identityB);

    expect(workspaceStateA.slashCommands).toEqual(slashCommands);
    expect(workspaceStateB.slashCommands).toEqual([]);
    expect(workspaceStateA.workspaceInit.status).toBe("ready");
    expect(workspaceStateB.workspaceInit.status).toBe("idle");
    expect(workspaceStateA.modelSwitchRequestId).toBe("switch-a");
    expect(workspaceStateA.modelSwitchPending).toBe(true);
    expect(workspaceStateB.modelSwitchRequestId).toBeNull();
    expect(workspaceStateB.modelSwitchPending).toBe(false);
  });

  it("When workspaceIdentity already exists, task configs from the path bucket are no longer dynamically merged", () => {
    const workspacePath = "/tmp/workspace-same-path-model-config";
    const identityA = "ssh://host-a/tmp/workspace-same-path-model-config";
    const identityB = "ssh://host-b/tmp/workspace-same-path-model-config";

    useCfSessionStore
      .getState()
      .setTaskConfigOptions(workspacePath, "task-1", [createModelConfigOption("glm-path")]);
    useCfSessionStore.getState().startDraft(workspacePath, "glm", identityA);
    useCfSessionStore
      .getState()
      .setConfigOptions(workspacePath, [createModelConfigOption("glm-identity-b")], identityB);
    useCfSessionStore
      .getState()
      .setTaskConfigOptions(
        workspacePath,
        "task-1",
        [createModelConfigOption("glm-identity-a")],
        identityA,
      );

    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, identityA)
        .taskConfigOptionsByTaskId["task-1"]?.[0]?.currentValue,
    ).toBe("glm-identity-a");
    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, identityB)
        .taskConfigOptionsByTaskId["task-1"],
    ).toBeUndefined();
  });

  it("First write of workspaceIdentity only migrates path task states explicitly belonging to that identity", () => {
    const workspacePath = "/tmp/workspace-same-path-task-cache";
    const workspaceIdentity = "ssh://host-a/tmp/workspace-same-path-task-cache";
    const otherWorkspaceIdentity = "ssh://host-b/tmp/workspace-same-path-task-cache";
    const taskId = "identity-task";
    const otherTaskId = "other-task";
    useCfSessionStore.getState().setTaskListCache(workspacePath, [
      createTaskMeta({
        taskId,
        workspacePath,
        workspaceIdentity,
        model: "glm-path",
      }),
      createTaskMeta({
        taskId: otherTaskId,
        workspacePath,
        workspaceIdentity: otherWorkspaceIdentity,
        model: "glm-other",
      }),
    ]);
    useCfSessionStore
      .getState()
      .setTaskConfigOptions(workspacePath, taskId, [createModelConfigOption("glm-path")]);
    useCfSessionStore.getState().setTaskRuntimeState(workspacePath, taskId, "streaming");
    useCfSessionStore
      .getState()
      .setTaskError(workspacePath, taskId, createCfError({ taskId }));
    useCfSessionStore
      .getState()
      .setTaskConfigOptions(workspacePath, otherTaskId, [createModelConfigOption("glm-other")]);

    useCfSessionStore
      .getState()
      .setConfigOptions(
        workspacePath,
        [createModelConfigOption("glm-identity")],
        workspaceIdentity,
      );

    const workspaceState = useCfSessionStore
      .getState()
      .getWorkspaceState(workspacePath, workspaceIdentity);

    expect(workspaceState.configOptions?.[0]?.currentValue).toBe("glm-identity");
    expect(workspaceState.taskListCache?.map((task) => task.taskId)).toEqual([taskId]);
    expect(readModelConfigValue(workspaceState.taskConfigOptionsByTaskId[taskId])).toBe("glm-path");
    expect(getTaskRuntimeState(workspaceState, taskId).status).toBe("streaming");
    expect(getTaskUiState(workspaceState, taskId).error?.message).toBe("命令执行失败");
    expect(workspaceState.taskConfigOptionsByTaskId[otherTaskId]).toBeUndefined();
  });

  it("modelSwitch state only allows the latest requestId to take effect and converge", () => {
    const workspacePath = "/tmp/workspace-model-switch";
    const requestId1 = "switch-1";
    const requestId2 = "switch-2";

    useCfSessionStore.getState().startModelSwitch(workspacePath, requestId1, "settingModel");
    useCfSessionStore
      .getState()
      .updateModelSwitchStage(workspacePath, requestId1, "restartingRuntime");
    useCfSessionStore.getState().startModelSwitch(workspacePath, requestId2, "syncingSession");

    useCfSessionStore.getState().finishModelSwitch(workspacePath, requestId1);
    let workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(workspaceState.modelSwitchPending).toBe(true);
    expect(workspaceState.modelSwitchRequestId).toBe(requestId2);
    expect(workspaceState.modelSwitchStage).toBe("syncingSession");

    useCfSessionStore.getState().finishModelSwitch(workspacePath, requestId2);
    workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(workspaceState.modelSwitchPending).toBe(false);
    expect(workspaceState.modelSwitchRequestId).toBeNull();
    expect(workspaceState.modelSwitchStage).toBe("idle");
  });

  it("removeTaskState synchronously closes the right detail view when deleting the current task", () => {
    const workspacePath = "/tmp/workspace-delete";
    const taskId = "task-active";

    useCfSessionStore
      .getState()
      .upsertOptimisticTaskListItem(workspacePath, createTaskMeta({ taskId, workspacePath }));
    useCfSessionStore.getState().setActiveTaskId(workspacePath, taskId);
    useCfSessionStore.getState().setTaskRuntimeState(workspacePath, taskId, "streaming");

    useCfSessionStore.getState().removeTaskState(workspacePath, taskId);

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(workspaceState.activeTaskId).toBeNull();
    expect(getWorkspaceDisplayedTaskState(workspaceState).taskStatus).toBe("idle");
    expect(getWorkspaceDisplayedTaskState(workspaceState).taskError).toBeNull();
    expect(workspaceState.optimisticTaskListByTaskId[taskId]).toBeUndefined();
    expect(workspaceState.taskRuntimeByTaskId[taskId]).toBeUndefined();
  });

  it("权限请求会按 task 维度保存，切换任务后仍可恢复", () => {
    const workspacePath = "/tmp/workspace-task-ui";
    const firstTaskId = "task-plan";
    const secondTaskId = "task-empty";
    const permissionRequest = createPermissionRequest({ taskId: firstTaskId });

    useCfSessionStore
      .getState()
      .setTaskPermissionRequest(workspacePath, firstTaskId, permissionRequest);
    useCfSessionStore.getState().setActiveTaskId(workspacePath, firstTaskId);
    useCfSessionStore.getState().setActiveTaskId(workspacePath, secondTaskId);
    useCfSessionStore.getState().setActiveTaskId(workspacePath, firstTaskId);

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(getTaskUiState(workspaceState, firstTaskId)).toEqual({
      ...DEFAULT_TASK_UI_STATE,
      permissionRequest,
    });
    expect(getTaskUiState(workspaceState, secondTaskId)).toEqual(DEFAULT_TASK_UI_STATE);
  });

  it("Q&A drafts are isolated by workspace, task, and request, and can be cleaned up after requests conclude", () => {
    const workspacePath = "/tmp/workspace-elicitation-draft";
    const firstTaskId = "task-a";
    const secondTaskId = "task-b";
    const requestId = "ask-1";
    const workspaceIdentity = "ssh://host-a/workspace";
    const draft = {
      questionIndex: 1,
      drafts: {
        "0: Solution": { selectedValues: ["safe"], customAnswer: "" },
      },
    };

    useCfSessionStore
      .getState()
      .setTaskElicitationFormDraft(workspacePath, firstTaskId, requestId, draft, workspaceIdentity);

    let workspaceState = useCfSessionStore
      .getState()
      .getWorkspaceState(workspacePath, workspaceIdentity);
    expect(
      getTaskUiState(workspaceState, firstTaskId).elicitationFormDraftsByRequestId[requestId],
    ).toEqual(draft);
    expect(
      getTaskUiState(workspaceState, secondTaskId).elicitationFormDraftsByRequestId[requestId],
    ).toBeUndefined();
    const otherWorkspaceState = useCfSessionStore
      .getState()
      .getWorkspaceState(workspacePath, "ssh://host-b/workspace");
    expect(
      getTaskUiState(otherWorkspaceState, firstTaskId).elicitationFormDraftsByRequestId[requestId],
    ).toBeUndefined();

    useCfSessionStore
      .getState()
      .removeTaskElicitationFormDraft(workspacePath, firstTaskId, requestId, workspaceIdentity);

    workspaceState = useCfSessionStore
      .getState()
      .getWorkspaceState(workspacePath, workspaceIdentity);
    expect(
      getTaskUiState(workspaceState, firstTaskId).elicitationFormDraftsByRequestId[requestId],
    ).toBeUndefined();
  });

  it("Multiple incoming permission requests are queued in order and automatically switch to the next after responding to the current one", () => {
    const workspacePath = "/tmp/workspace-task-permission-queue";
    const taskId = "task-permission-queue";
    const firstPermissionRequest = createPermissionRequest({
      taskId,
      requestId: "perm-1",
      description: "允许读取 about.txt",
    });
    const secondPermissionRequest = createPermissionRequest({
      taskId,
      requestId: "perm-2",
      description: "允许读取 setting.json",
    });

    useCfSessionStore
      .getState()
      .setTaskPermissionRequest(workspacePath, taskId, firstPermissionRequest);
    useCfSessionStore
      .getState()
      .setTaskPermissionRequest(workspacePath, taskId, secondPermissionRequest);

    let workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(getTaskUiState(workspaceState, taskId)).toEqual({
      ...DEFAULT_TASK_UI_STATE,
      permissionRequest: firstPermissionRequest,
      pendingPermissionRequests: [secondPermissionRequest],
    });

    useCfSessionStore.getState().removeTaskPermissionRequest(workspacePath, taskId, "perm-1");

    workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(getTaskUiState(workspaceState, taskId)).toEqual({
      ...DEFAULT_TASK_UI_STATE,
      permissionRequest: secondPermissionRequest,
    });
  });

  it("Repeatedly receiving the same permission request will not rebuild task UI state", () => {
    const workspacePath = "/tmp/workspace-task-permission-duplicate";
    const taskId = "task-permission-duplicate";
    const firstPermissionRequest = createPermissionRequest({ taskId, requestId: "perm-duplicate" });
    const duplicatePermissionRequest = createPermissionRequest({
      taskId,
      requestId: "perm-duplicate",
    });

    useCfSessionStore
      .getState()
      .setTaskPermissionRequest(workspacePath, taskId, firstPermissionRequest);

    const firstWorkspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    const firstTaskUiState = getTaskUiState(firstWorkspaceState, taskId);

    useCfSessionStore
      .getState()
      .setTaskPermissionRequest(workspacePath, taskId, duplicatePermissionRequest);

    const secondWorkspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(secondWorkspaceState).toBe(firstWorkspaceState);
    expect(getTaskUiState(secondWorkspaceState, taskId)).toBe(firstTaskUiState);
  });

  it("Repeatedly cleaning up removed permission requests will not rebuild task UI state", () => {
    const workspacePath = "/tmp/workspace-task-permission-response-duplicate";
    const taskId = "task-permission-response-duplicate";
    const permissionRequest = createPermissionRequest({ taskId, requestId: "perm-response" });

    useCfSessionStore
      .getState()
      .setTaskPermissionRequest(workspacePath, taskId, permissionRequest);
    useCfSessionStore
      .getState()
      .removeTaskPermissionRequest(workspacePath, taskId, "perm-response");

    const firstWorkspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);

    useCfSessionStore
      .getState()
      .removeTaskPermissionRequest(workspacePath, taskId, "perm-response");

    const secondWorkspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(secondWorkspaceState).toBe(firstWorkspaceState);
  });

  it("Task errors are saved in memory per task and can still be restored after switching tasks", () => {
    const workspacePath = "/tmp/workspace-task-error";
    const firstTaskId = "task-error";
    const secondTaskId = "task-other";
    const error = createCfError({ taskId: firstTaskId });

    useCfSessionStore.getState().setTaskError(workspacePath, firstTaskId, error);
    useCfSessionStore.getState().setActiveTaskId(workspacePath, firstTaskId);
    useCfSessionStore.getState().setActiveTaskId(workspacePath, secondTaskId);
    useCfSessionStore.getState().setActiveTaskId(workspacePath, firstTaskId);

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(getTaskUiState(workspaceState, firstTaskId).error).toEqual(error);
    expect(getTaskUiState(workspaceState, secondTaskId).error).toBeNull();
  });

  it("Draft errors are retained in workspace memory and cleared upon creating a new draft", () => {
    const workspacePath = "/tmp/workspace-draft-error";
    const error = createCfError({ taskId: undefined });

    useCfSessionStore.getState().setDraftError(workspacePath, error);
    expect(useCfSessionStore.getState().getWorkspaceState(workspacePath).draftError).toEqual(
      error,
    );

    useCfSessionStore.getState().startDraft(workspacePath);
    expect(useCfSessionStore.getState().getWorkspaceState(workspacePath).draftError).toBeNull();
  });

  it("After the current task is marked unread via right-click, opening it again also clears the optimistic blue dot", () => {
    const workspacePath = "/tmp/workspace-task-read";
    const taskId = "task-unread";
    useCfSessionStore
      .getState()
      .upsertOptimisticTaskListItem(workspacePath, createTaskMeta({ taskId, workspacePath }));
    useCfSessionStore.getState().setActiveTaskId(workspacePath, taskId);
    useCfSessionStore.getState().setTaskUnreadIndicator(workspacePath, taskId, true);
    useCfSessionStore
      .getState()
      .upsertOptimisticTaskListItem(
        workspacePath,
        createTaskMeta({ taskId, workspacePath, unreadAt: 123 }),
      );

    expect(
      getTaskUnreadIndicator(
        useCfSessionStore.getState().getWorkspaceState(workspacePath),
        taskId,
      ),
    ).toBe(true);

    useCfSessionStore.getState().setActiveTaskId(workspacePath, taskId);

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(getTaskUnreadIndicator(workspaceState, taskId)).toBe(false);
    expect(workspaceState.optimisticTaskListByTaskId[taskId]?.unreadAt).toBeUndefined();
  });

  it("Repeatedly cleaning up read tasks will not rebuild workspace state", () => {
    const workspacePath = "/tmp/workspace-task-read-noop";
    const taskId = "task-unread-noop";
    useCfSessionStore.getState().setTaskUnreadIndicator(workspacePath, taskId, true);
    useCfSessionStore.getState().setTaskUnreadIndicator(workspacePath, taskId, false);

    const firstWorkspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);

    useCfSessionStore.getState().setTaskUnreadIndicator(workspacePath, taskId, false);

    const secondWorkspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(secondWorkspaceState).toBe(firstWorkspaceState);
  });

  it("Switching to an existing task warms up task config with task meta without overwriting workspace default config", () => {
    const workspacePath = "/tmp/workspace-task-model-preload";
    const taskId = "task-glm51";
    const staleWorkspaceModel = "glm-0531[1m]";
    const taskModel = "bigmodel-api/GLM-5.1";

    useCfSessionStore
      .getState()
      .setConfigOptions(workspacePath, [createModelConfigOption(staleWorkspaceModel)]);
    useCfSessionStore.getState().upsertOptimisticTaskListItem(
      workspacePath,
      createTaskMeta({
        taskId,
        workspacePath,
        provider: "glm",
        model: taskModel,
      }),
    );

    useCfSessionStore.getState().setActiveTaskId(workspacePath, taskId);

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(readModelConfigValue(workspaceState.configOptions)).toBe(staleWorkspaceModel);
    expect(readModelConfigValue(workspaceState.taskConfigOptionsByTaskId[taskId])).toBe(
      encodeCustomModelValue("bigmodel-api", "GLM-5.1"),
    );
    expect(workspaceState.taskConfigOptionsStatusByTaskId[taskId]).toBe("loading");
  });

  it("Active task config updates only write to the task config bucket without overwriting workspace default config", () => {
    const workspacePath = "/tmp/workspace-task-config-isolation";
    const taskId = "task-active-config";
    const workspaceModel = "glm-0531[1m]";
    const taskModel = "bigmodel-api/GLM-5.1";

    useCfSessionStore
      .getState()
      .setConfigOptions(workspacePath, [createModelConfigOption(workspaceModel)]);
    useCfSessionStore.getState().setActiveTaskId(workspacePath, taskId);
    useCfSessionStore
      .getState()
      .setTaskConfigOptions(workspacePath, taskId, [createModelConfigOption(taskModel)]);

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(readModelConfigValue(workspaceState.configOptions)).toBe(workspaceModel);
    expect(readModelConfigValue(workspaceState.taskConfigOptionsByTaskId[taskId])).toBe(taskModel);
    expect(workspaceState.taskConfigOptionsStatusByTaskId[taskId]).toBe("ready");
  });

  it("Identical workspace configs will not repeatedly notify subscribers", () => {
    const workspacePath = "/tmp/workspace-config-options-dedupe";
    const modelValue = "account:zai-start-plan/GLM-5.2";
    let notificationCount = 0;
    const unsubscribe = useCfSessionStore.subscribe(() => {
      notificationCount += 1;
    });

    useCfSessionStore
      .getState()
      .setConfigOptions(workspacePath, [createModelConfigOption(modelValue)]);
    expect(notificationCount).toBe(1);

    useCfSessionStore
      .getState()
      .setConfigOptions(workspacePath, [createModelConfigOption(modelValue)]);

    unsubscribe();
    expect(notificationCount).toBe(1);
  });

  it("Identical task configs will not repeatedly notify subscribers", () => {
    const workspacePath = "/tmp/workspace-task-config-options-dedupe";
    const taskId = "task-config-dedupe";
    const modelValue = "account:zai-start-plan/GLM-5.2";
    let notificationCount = 0;
    const unsubscribe = useCfSessionStore.subscribe(() => {
      notificationCount += 1;
    });

    useCfSessionStore
      .getState()
      .setTaskConfigOptions(workspacePath, taskId, [createModelConfigOption(modelValue)]);
    expect(notificationCount).toBe(1);

    useCfSessionStore
      .getState()
      .setTaskConfigOptions(workspacePath, taskId, [createModelConfigOption(modelValue)]);

    unsubscribe();
    expect(notificationCount).toBe(1);
  });

  it("Forwarding or navigating back in tasks when selecting a target will not overwrite browser-style history positions", () => {
    const workspacePath = "/tmp/workspace-task-nav";

    useCfSessionStore.getState().setActiveTaskId(workspacePath, "task-a");
    useCfSessionStore.getState().setActiveTaskId(workspacePath, "task-b");

    const backEntry = useCfSessionStore.getState().taskNavGoBack();
    expect(backEntry?.taskId).toBe("task-a");
    useCfSessionStore.getState().setActiveTaskId(workspacePath, "task-a");

    expect(canGoForward(useCfSessionStore.getState().taskNavHistory)).toBe(true);
    expect(useCfSessionStore.getState().taskNavGoForward()?.taskId).toBe("task-b");
  });

  it("removeTaskState 会同时清理 task 级权限请求", () => {
    const workspacePath = "/tmp/workspace-remove-task-ui";
    const taskId = "task-remove-ui";

    useCfSessionStore
      .getState()
      .setTaskPermissionRequest(workspacePath, taskId, createPermissionRequest({ taskId }));

    useCfSessionStore.getState().removeTaskState(workspacePath, taskId);

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(workspaceState.taskUiByTaskId[taskId]).toBeUndefined();
  });

  it("Task usage is saved per task and is not lost when switching runtime states", () => {
    const workspacePath = "/tmp/workspace-task-usage";
    const taskId = "task-usage";

    useCfSessionStore.getState().setTaskUsage(workspacePath, taskId, {
      used: 53000,
      size: 200000,
      cost: { amount: 0.045, currency: "USD" },
    });
    useCfSessionStore.getState().setTaskRuntimeState(workspacePath, taskId, "streaming");
    useCfSessionStore.getState().setTaskRuntimeState(workspacePath, taskId, "completed");

    const workspaceState = useCfSessionStore.getState().getWorkspaceState(workspacePath);
    expect(getTaskRuntimeState(workspaceState, taskId)).toEqual({
      ...DEFAULT_TASK_RUNTIME_STATE,
      status: "completed",
      error: null,
      apiRetry: null,
      usage: {
        used: 53000,
        size: 200000,
        cost: { amount: 0.045, currency: "USD" },
      },
    });
  });

  it("Task contextWindow updates separately without overwriting existing usage", () => {
    const workspacePath = "/tmp/workspace-task-context-window";
    const taskId = "task-context-window";

    useCfSessionStore.getState().setTaskUsage(workspacePath, taskId, {
      used: 11804,
      size: 200000,
      cost: null,
      cache: {
        inputTokens: 100,
        cacheReadTokens: 40,
        cacheWriteTokens: 0,
        hitRate: 0.4,
      },
      breakdown: [{ source: "messages", chars: 1200 }],
    });
    useCfSessionStore.getState().setTaskContextWindow(workspacePath, taskId, 1000000);

    const runtime = getTaskRuntimeState(
      useCfSessionStore.getState().getWorkspaceState(workspacePath),
      taskId,
    );
    expect(runtime.contextWindow).toBe(1000000);
    expect(runtime.usage).toEqual({
      used: 11804,
      size: 200000,
      cost: null,
      cache: {
        inputTokens: 100,
        cacheReadTokens: 40,
        cacheWriteTokens: 0,
        hitRate: 0.4,
      },
      breakdown: [{ source: "messages", chars: 1200 }],
    });
  });

  it("Identical task usage will not repeatedly notify subscribers", () => {
    const workspacePath = "/tmp/workspace-task-usage-dedupe";
    const taskId = "task-usage-dedupe";
    let notificationCount = 0;
    const unsubscribe = useCfSessionStore.subscribe(() => {
      notificationCount += 1;
    });

    useCfSessionStore.getState().setTaskUsage(workspacePath, taskId, {
      used: 53000,
      size: 200000,
      cost: { amount: 0.045, currency: "USD" },
    });
    expect(notificationCount).toBe(1);

    useCfSessionStore.getState().setTaskUsage(workspacePath, taskId, {
      used: 53000,
      size: 200000,
      cost: { amount: 0.045, currency: "USD" },
    });

    unsubscribe();
    expect(notificationCount).toBe(1);
  });

  it("configOptionsStatus writing to workspace identity does not pollute the path bucket", () => {
    const workspacePath = "/tmp/workspace-config-status-identity";
    const workspaceIdentity = "ssh://host-a/tmp/workspace-config-status-identity";

    useCfSessionStore.getState().setConfigOptionsStatus(workspacePath, "loading");
    useCfSessionStore
      .getState()
      .setConfigOptionsStatus(workspacePath, "error", workspaceIdentity);

    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath).configOptionsStatus,
    ).toBe("loading");
    expect(
      useCfSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
        .configOptionsStatus,
    ).toBe("error");
  });
});
