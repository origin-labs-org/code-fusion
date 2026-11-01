//
import { describe, expect, it } from "vitest";
import {
  CREATE_WORKFLOW_TOOL_NAME,
  SAVE_WORKFLOW_TOOL_NAME,
  SessionEventType,
  type EventId,
  type SessionEvent,
  type SessionEventType as SessionEventTypeUnion,
  type SessionId,
  type TraceId,
  type TurnId,
} from "@origin-ai/cf-contracts";
import { conversationSnapshotSchema } from "@origin-ai/cf-shared/cf-protocol-v4";
import { builtInTools } from "@origin-ai/cf-core";
import { ProductProjection } from "../src/cf-protocol-v4/index.js";

class EventLog {
  private seq = 0;
  readonly events: SessionEvent[] = [];

  push(type: SessionEventTypeUnion, payload: unknown, turnId = "turn-1"): SessionEvent {
    this.seq += 1;
    const event: SessionEvent = {
      id: `event-${this.seq}` as EventId,
      sessionId: "session-1" as SessionId,
      turnId: turnId as TurnId,
      type,
      timestamp: new Date(1_700_000_000_000 + this.seq * 1000),
      traceId: "trace-1" as TraceId,
      sequenceNumber: this.seq,
      payload,
    };
    this.events.push(event);
    return event;
  }
}

function project(events: readonly SessionEvent[]): ProductProjection {
  const projection = new ProductProjection("session-1", "epoch-1");
  for (const event of events) projection.applyEvent(event);
  return projection;
}

function permissionPayload(projection: ProductProjection) {
  const payload = projection.getSnapshot().pendingInteractions[0]?.payload;
  expect(payload?.kind).toBe("permission");
  if (payload?.kind !== "permission") throw new Error("unreachable");
  return payload;
}

function gateEvents(options: {
  toolName: string;
  input: unknown;
  reason: string;
  display?: unknown;
  optionsPolicy?: string;
}): SessionEvent[] {
  const log = new EventLog();
  log.push(SessionEventType.SessionCreated, { mode: "default", contextWindow: 1000 });
  log.push(SessionEventType.TurnStarted, { turnNumber: 1, input: "run it" });
  log.push(SessionEventType.ToolCallScheduled, {
    toolCallId: "tc-1",
    toolName: options.toolName,
    input: options.input,
    schedule: { parallelGroups: [["tc-1"]], executionOrder: ["tc-1"] },
  });
  log.push(SessionEventType.PermissionRequested, {
    requestId: "req-1",
    toolCallId: "tc-1",
    toolName: options.toolName,
    riskLevel: "low",
    reason: options.reason,
    input: options.input,
    ...(options.optionsPolicy === undefined ? {} : { optionsPolicy: options.optionsPolicy }),
    ...(options.display === undefined ? {} : { display: options.display }),
  });
  return log.events;
}

const SCRIPT = \'const r = agent("检查员");\nreturn await r.ask<string>("检查一遍");\';

const SAVED_RUN_INPUT = {
  name: "release-check",
  script: SCRIPT,
  saved: {
    name: "release-check",
    args: {
      target: "packages/core",
      depth: 3,
      skipTests: false,
      matrix: { os: ["mac", "win"], strict: true },
    },
    path: "/repo/.cf/workflows/release-check.dwf.ts",
    scope: "project",
  },
};

const INLINE_RUN_INPUT = { name: "release-check", script: SCRIPT };

const WORKFLOW_DISPLAY = {
  kind: "create_workflow",
  ok: true,
  errorCount: 0,
  diagnostics: [],
  causalityGraph: {
    steps: [
      {
        id: "ask#1",
        kind: "ask",
        label: "检查员",
        line: 2,
        column: 14,
        lane: "actor#1",
      },
    ],
    lanes: [{ id: "actor#1", name: "检查员" }],
    participants: [
      { id: "unphased:actor#1", phase: "unphased", lane: "actor#1", steps: ["ask#1"] },
    ],
    handoffs: [],
    sink: ["ask#1"],
  },
};

/** SaveWorkflow：`{name, description, whenToUse?, args?, script, path, overwrite, scope}`。 */
const SAVE_INPUT = {
  name: "release-check",
  description: "对本仓库做一次发布前检查",
  whenToUse: "用户说要发版时",
  args: { target: { type: "string", required: true, description: "要检查的包" } },
  script: SCRIPT,
  path: "/repo/.cf/workflows/release-check.dwf.ts",
  overwrite: true,
  scope: "project",
};

const saveWorkflowEntry = builtInTools.find(
  (entry) => entry.metadata.name === SAVE_WORKFLOW_TOOL_NAME,
);
const saveWorkflowOptionsPolicy =
  saveWorkflowEntry?.permission?.askOptions?.allowAlways === false ? "no-always-allow" : undefined;

describe("saved 源 CreateWorkflow 的确认窗（v4 投影）", () => {
  function savedGate(): ProductProjection {
    return project(
      gateEvents({
        toolName: CREATE_WORKFLOW_TOOL_NAME,
        input: SAVED_RUN_INPUT,
        reason: "createWorkflow.runConfirmation",
        display: WORKFLOW_DISPLAY,
        optionsPolicy: "no-always-allow",
      }),
    );
  }

  it("归一化入参整份进 detail：解析出的脚本与 saved 来龙去脉都在", () => {
    const payload = permissionPayload(savedGate());

    expect(payload.detail).toEqual(SAVED_RUN_INPUT);
    expect(payload.toolName).toBe(CREATE_WORKFLOW_TOOL_NAME);
  });

  it("四种类型的实参整份穿过 v4 快照 schema（detail 是 z.unknown() 的透传）", () => {
    const snapshot = savedGate().getSnapshot();
    const parsed = conversationSnapshotSchema.safeParse(snapshot);
    expect(parsed.success).toBe(true);

    const roundTripped = parsed.success ? parsed.data.pendingInteractions[0]?.payload : undefined;
    expect(roundTripped?.kind === "permission" && roundTripped.detail).toEqual(SAVED_RUN_INPUT);
  });

  it("Refine 选项按 toolName 合成：saved 与内联两条路径的选项列表逐字相同", () => {
    const savedOptions = permissionPayload(savedGate()).options;
    const inlineOptions = permissionPayload(
      project(
        gateEvents({
          toolName: CREATE_WORKFLOW_TOOL_NAME,
          input: INLINE_RUN_INPUT,
          reason: "createWorkflow.runConfirmation",
          display: WORKFLOW_DISPLAY,
          optionsPolicy: "no-always-allow",
        }),
      ),
    ).options;

    expect(savedOptions.map((option) => option.optionId)).toEqual([
      "allowOnce",
      "deny",
      "workflowRefine",
    ]);
    expect(savedOptions).toEqual(inlineOptions);
    expect(savedOptions.find((option) => option.optionId === "workflowRefine")).toMatchObject({
      kind: "custom",
      label: "Refine",
      response: { decision: "deny" },
    });
  });

  it("display 的字段集合一个都没多（不变式 8：本特性不改任何 display 载荷）", () => {
    const payload = permissionPayload(savedGate());
    expect(Object.keys(payload.display ?? {}).sort()).toEqual([
      "causalityGraph",
      "diagnostics",
      "errorCount",
      "kind",
      "ok",
    ]);
    expect(JSON.stringify(payload.display)).not.toContain(SAVED_RUN_INPUT.saved.path);
  });
});

describe("SaveWorkflow 的确认窗（v4 投影）", () => {
  function saveGate(input: unknown = SAVE_INPUT): ProductProjection {
    return project(
      gateEvents({
        toolName: SAVE_WORKFLOW_TOOL_NAME,
        input,
        reason: "saveWorkflow.confirmation",
        ...(saveWorkflowOptionsPolicy === undefined
          ? {}
          : { optionsPolicy: saveWorkflowOptionsPolicy }),
      }),
    );
  }

  it("落点、覆盖判定、scope 与完整脚本都在 detail 里", () => {
    const payload = permissionPayload(saveGate());

    expect(payload.toolName).toBe(SAVE_WORKFLOW_TOOL_NAME);
    expect(payload.detail).toEqual(SAVE_INPUT);
    expect(conversationSnapshotSchema.safeParse(saveGate().getSnapshot()).success).toBe(true);
  });

  it("新建态与覆盖态只差 detail 上的一个布尔（协议不为此分流）", () => {
    const created = permissionPayload(saveGate({ ...SAVE_INPUT, overwrite: false }));
    expect((created.detail as typeof SAVE_INPUT).overwrite).toBe(false);
    expect({ ...created, detail: undefined }).toEqual({
      ...permissionPayload(saveGate()),
      detail: undefined,
    });
  });

  it("不带 display：v1 刻意不加 save_workflow kind", () => {
    const payload = permissionPayload(saveGate());
    expect("display" in payload).toBe(false);
  });

  it("选项 = 允许一次 + 拒绝：没有 always allow，也没有 Refine", () => {
    expect(saveWorkflowOptionsPolicy).toBe("no-always-allow");

    const options = permissionPayload(saveGate()).options;
    expect(options.map((option) => option.optionId)).toEqual(["allowOnce", "deny"]);
    expect(options.some((option) => option.kind === "allowAlways")).toBe(false);
  });
});
