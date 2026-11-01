import { describe, expect, it } from "vitest";
import {
  EventReducer,
  SessionEventType,
  createSessionEvent,
  type EventId,
  type SessionEvent,
  type SessionId,
  type ToolCallId,
  type TraceId,
} from "@origin-ai/cf-contracts";
import { cfSessionEventSchema, cfSessionProjectionSchema } from "@origin-ai/cf-shared";
import {
  mapSessionEvent,
  mapSessionProjection,
  shouldExposeSessionEventToProtocol,
} from "../src/cf-protocol/session-mapper.js";

function permissionRequestedEvent(payload: Record<string, unknown>): SessionEvent {
  return {
    id: "legacy-permission-event" as EventId,
    sessionId: "legacy-session" as SessionId,
    type: SessionEventType.PermissionRequested,
    timestamp: new Date(1_700_000_000_000),
    traceId: "legacy-trace" as TraceId,
    sequenceNumber: 1,
    payload,
  };
}

describe("legacy permission.requested 映射", () => {
  const basePayload = {
    requestId: "req-1",
    toolCallId: "tc-1" as ToolCallId,
    toolName: "CreateWorkflow",
    riskLevel: "low",
    reason: "createWorkflow.runConfirmation",
    input: { script: "return 1;" },
  };

  
  it("saved run 的归一化入参整份过 strict schema，脚本不被剥离", () => {
    const normalizedInput = {
      name: "nightly",
      script:
        'interface R { done: boolean }\nconst r = await agent("w").ask<R>("do");\nreturn r.done;',
      saved: {
        name: "nightly",
        args: { depth: 3, target: "packages/core" },
        path: "/repo/.cf/workflows/nightly.dwf.ts",
        scope: "project",
      },
    };

    const mapped = mapSessionEvent(
      permissionRequestedEvent({
        ...basePayload,
        input: normalizedInput,
        display: { kind: "create_workflow", ok: true, errorCount: 0, diagnostics: [] },
        optionsPolicy: "no-always-allow",
      }),
    );

    expect(cfSessionEventSchema.safeParse(mapped).success).toBe(true);
    expect(mapped.payload).not.toHaveProperty("display");
    expect((mapped.payload as { input: unknown }).input).toEqual(normalizedInput);
  });

  
  it("SaveWorkflow 的归一化入参同样整份过 strict schema", () => {
    const normalizedInput = {
      name: "pr-review",
      description: "Review a pull request",
      script: "return 1;",
      path: "/repo/.cf/workflows/pr-review.dwf.ts",
      overwrite: true,
      scope: "project",
    };

    const mapped = mapSessionEvent(
      permissionRequestedEvent({
        ...basePayload,
        toolName: "SaveWorkflow",
        reason: "saveWorkflow.confirmation",
        input: normalizedInput,
        optionsPolicy: "no-always-allow",
      }),
    );

    expect(cfSessionEventSchema.safeParse(mapped).success).toBe(true);
    expect((mapped.payload as { input: unknown }).input).toEqual(normalizedInput);
  });

  it("仍按策略把选项收窄成允许一次 + 拒绝", () => {
    const mapped = mapSessionEvent(
      permissionRequestedEvent({ ...basePayload, optionsPolicy: "no-always-allow" }),
    );

    const options = (mapped.payload as { options: { optionId: string }[] }).options;
    expect(options.map((option) => option.optionId)).toEqual(["allow_once", "deny"]);
  });

  it("session-always-allow 在 legacy 上降为允许一次 + 拒绝，且过 strict schema", () => {
    const mapped = mapSessionEvent(
      permissionRequestedEvent({ ...basePayload, optionsPolicy: "session-always-allow" }),
    );

    expect(cfSessionEventSchema.safeParse(mapped).success).toBe(true);
    expect(mapped.payload).not.toHaveProperty("optionsPolicy");
    const options = (mapped.payload as { options: { optionId: string; kind: string }[] }).options;
    expect(options.map((option) => option.optionId)).toEqual(["allow_once", "deny"]);
    expect(options.some((option) => option.kind === "allow_session")).toBe(false);
  });

  it("未声明策略的工具保持默认三个选项", () => {
    const mapped = mapSessionEvent(
      permissionRequestedEvent({ ...basePayload, toolName: "Bash", input: { command: "ls" } }),
    );

    const options = (mapped.payload as { options: { optionId: string }[] }).options;
    expect(options.map((option) => option.optionId)).toEqual([
      "allow_once",
      "allow_project",
      "deny",
    ]);
  });

  it("带 display 的请求经两个 legacy mapper 后同时通过两个 strict schema", () => {
    const sessionId = "legacy-session" as SessionId;
    const display = {
      kind: "create_workflow",
      ok: true,
      errorCount: 0,
      diagnostics: [],
      causalityGraph: {
        steps: [
          {
            id: "ask#1",
            kind: "ask",
            label: "a",
            line: 2,
            column: 11,
            lane: "actor#1",
          },
        ],
        lanes: [{ id: "actor#1", name: "a" }],
        participants: [
          { id: "unphased:actor#1", phase: "unphased", lane: "actor#1", steps: ["ask#1"] },
        ],
        handoffs: [],
        sink: ["ask#1"],
      },
    };
    const askPayload = { ...basePayload, display, optionsPolicy: "no-always-allow" };

    const mappedEvent = mapSessionEvent(permissionRequestedEvent(askPayload));
    expect(cfSessionEventSchema.safeParse(mappedEvent).success).toBe(true);

    const projection = new EventReducer().reduce([
      createSessionEvent(SessionEventType.SessionCreated, sessionId, {
        mode: "build",
        contextWindow: 200_000,
      }),
      createSessionEvent(SessionEventType.PermissionRequested, sessionId, askPayload),
    ]);
    expect(projection.pendingPermissions[0]?.display).toEqual(display);

    const mappedProjection = mapSessionProjection(projection);
    const parsedProjection = cfSessionProjectionSchema.safeParse(mappedProjection);
    expect(parsedProjection.success).toBe(true);
    const pending = mappedProjection.pendingPermissions[0]!;
    expect(pending).not.toHaveProperty("display");
    expect(pending).not.toHaveProperty("optionsPolicy");
    expect(pending.options.map((option) => option.optionId)).toEqual(["allow_once", "deny"]);
  });

  
  it("两个工具的归一化入参在快照通道上同样整份存活", () => {
    const sessionId = "legacy-session" as SessionId;
    const savedRunInput = {
      name: "release-check",
      script: 'return await agent("检查员").ask<string>("检查一遍");',
      saved: {
        name: "release-check",
        args: { target: "packages/core", depth: 3, skipTests: false },
        path: "/repo/.cf/workflows/release-check.dwf.ts",
        scope: "project",
      },
    };
    const saveInput = {
      name: "release-check",
      description: "对本仓库做一次发布前检查",
      script: "return 1;",
      path: "/repo/.cf/workflows/release-check.dwf.ts",
      overwrite: true,
      scope: "project",
    };

    const projection = new EventReducer().reduce([
      createSessionEvent(SessionEventType.SessionCreated, sessionId, {
        mode: "build",
        contextWindow: 200_000,
      }),
      createSessionEvent(SessionEventType.PermissionRequested, sessionId, {
        ...basePayload,
        input: savedRunInput,
        display: { kind: "create_workflow", ok: true, errorCount: 0, diagnostics: [] },
        optionsPolicy: "no-always-allow",
      }),
      createSessionEvent(SessionEventType.PermissionRequested, sessionId, {
        ...basePayload,
        requestId: "req-2",
        toolCallId: "tc-2" as ToolCallId,
        toolName: "SaveWorkflow",
        reason: "saveWorkflow.confirmation",
        input: saveInput,
        optionsPolicy: "no-always-allow",
      }),
    ]);

    const mapped = mapSessionProjection(projection);
    expect(cfSessionProjectionSchema.safeParse(mapped).success).toBe(true);
    expect(mapped.pendingPermissions.map((pending) => pending.input)).toEqual([
      savedRunInput,
      saveInput,
    ]);
    for (const pending of mapped.pendingPermissions) {
      expect(pending).not.toHaveProperty("display");
      expect(pending.options.map((option) => option.optionId)).toEqual(["allow_once", "deny"]);
    }
  });
});

describe("legacy v3 剥离 dwf run 进度事件", () => {
  function runProgressEvent(): SessionEvent {
    return {
      id: "dwf-progress-event" as EventId,
      sessionId: "legacy-session" as SessionId,
      type: SessionEventType.DynamicWorkflowRunProgress,
      timestamp: new Date(1_700_000_000_000),
      traceId: "legacy-trace" as TraceId,
      sequenceNumber: 3,
      payload: {
        runId: "dwfrun-1",
        toolCallId: "tc-1" as ToolCallId,
        sequence: 5,
        eventType: "node-settled",
        payload: { instance: { siteId: "ask#1", ordinal: 1 }, outcome: "ok" },
      },
    };
  }

  it("不透出到 v3 协议流", () => {
    expect(shouldExposeSessionEventToProtocol(runProgressEvent())).toBe(false);
  });

  it("与 StreamingToolLedgerUpdated 同一个判定，且不影响其它事件", () => {
    expect(
      shouldExposeSessionEventToProtocol({
        ...runProgressEvent(),
        type: SessionEventType.StreamingToolLedgerUpdated,
      }),
    ).toBe(false);
    expect(
      shouldExposeSessionEventToProtocol({
        ...runProgressEvent(),
        type: SessionEventType.BackgroundTaskStarted,
      }),
    ).toBe(true);
  });

  it("万一被透出，映射结果仍过 strict schema（v3 侧没有状态键要剥）", () => {
    const mapped = mapSessionEvent(runProgressEvent());
    expect(cfSessionEventSchema.safeParse(mapped).success).toBe(true);
    expect(
      cfSessionProjectionSchema.safeParse(
        mapSessionProjection(
          new EventReducer().reduce([
            createSessionEvent(SessionEventType.SessionCreated, "legacy-session" as SessionId, {
              mode: "build",
              contextWindow: 200_000,
            }),
            runProgressEvent(),
          ]),
        ),
      ).success,
    ).toBe(true);
  });
});
