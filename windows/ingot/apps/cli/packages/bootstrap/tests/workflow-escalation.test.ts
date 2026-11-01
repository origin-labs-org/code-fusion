

import { describe, expect, it } from "vitest";
import {
  createRootTraceContext,
  createSessionId,
  createToolCallId,
  createTurnId,
  DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS,
  ESCALATE_TOOL_NAME,
  RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
  type EscalateQuestionRequest,
  type WorkflowEscalatePort,
} from "@origin-ai/cf-contracts";
import {
  InMemoryJournalStore,
  type ActorRef,
  type InstanceRef,
  type PersonaSpec,
  type RunEvent,
  type SessionRef,
  type WorkflowDriver,
  type WorkflowReportSink,
} from "@origin-ai/cf-dynamic-workflow";
import { toProtocolEvent } from "../src/app/dynamic-workflow-run-launch.js";
import { workflowActorToolPolicy } from "../src/app/workflow-actor-tools.js";
import { createAgentRuntimeWorkflowDriver } from "../src/app/workflow-driver.js";
import {
  createWorkflowEscalationRegistry,
  type WorkflowEscalationRegistry,
} from "../src/app/workflow-escalation-registry.js";
import { fakeFileSystemPort, unsupportedExecutionPort } from "./workflow-driver.helpers.js";

const NOOP_SINK: WorkflowReportSink = {
  askSubmitAttempted: () => {},
  askTurnEnded: () => {},
  askProgress: () => {},
  askStats: () => {},
  askFailed: () => {},
};

const CAPS = { maxConcurrency: 16 };

function escalateRequest(question: string, context?: string): EscalateQuestionRequest {
  const sessionId = createSessionId("escalation-test");
  return {
    toolCallId: createToolCallId("escalate-call"),
    question,
    ...(context === undefined ? {} : { context }),
    trace: createRootTraceContext({ sessionId, turnId: createTurnId("escalation-test") }),
  };
}

interface EscalationHarness {
  driver: WorkflowDriver;
  events: RunEvent[];
  journal: InMemoryJournalStore;
  registry: WorkflowEscalationRegistry;
  runId: string;
  
  openAsk(
    ordinal?: number,
    persona?: PersonaSpec,
  ): Promise<{ port: WorkflowEscalatePort; session: SessionRef; instance: InstanceRef }>;
}

function makeHarness(
  options: { registry?: WorkflowEscalationRegistry; runId?: string } = {},
): EscalationHarness {
  const runId = options.runId ?? "dwfrun-11112222-3333-4444";
  const journal = new InMemoryJournalStore();
  journal.createRun({ runId, caps: CAPS, spentTokens: 0, status: "running" });
  const registry = options.registry ?? createWorkflowEscalationRegistry();
  const events: RunEvent[] = [];
  const ports: WorkflowEscalatePort[] = [];

  const driver = createAgentRuntimeWorkflowDriver({
    journal,
    emit: (event) => events.push(event),
    escalationRegistry: registry,
    executionPort: unsupportedExecutionPort(),
    fileSystemPort: fakeFileSystemPort({}),
    cwd: process.cwd(),
    runId,
    runtimeFactory: ({ escalatePort }) => {
      ports.push(escalatePort);
      return { executeTurn: () => new Promise(() => {}) } as never;
    },
  })(NOOP_SINK);

  return {
    driver,
    events,
    journal,
    registry,
    runId,
    async openAsk(ordinal = 1, persona: PersonaSpec = {}) {
      const actor: ActorRef = { siteId: "actor#1", ordinal };
      const session = await driver.createActorSession(actor, persona);
      const instance: InstanceRef = { siteId: "ask#1", ordinal };
      driver.startAsk(session, instance, { instructions: "go", typed: false });
      const port = ports[ports.length - 1];
      if (port === undefined) throw new Error("runtimeFactory 没有交出 escalatePort");
      return { port, session, instance };
    },
  };
}

describe("workflow escalation — 停驻与结算", () => {
  it("停驻的问题被作答后，答案原样成为 escalate 的结果", async () => {
    const harness = makeHarness();
    const { port } = await harness.openAsk();

    const pending = port.escalate(escalateRequest("评分上限 95 而门槛 96，这个门是不是坏了？"));
    const parked = harness.registry.pendingFor(harness.runId);
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({
      actor: "actor#1@1",
      question: "评分上限 95 而门槛 96，这个门是不是坏了？",
    });
    expect(parked[0]?.qid).toMatch(/^dwfq-11112222-1$/);
    expect(typeof parked[0]?.askedAt).toBe("number");

    const resolved = harness.registry.resolve(parked[0]!.qid, "门确实坏了，按 95 通过即可。");
    expect(resolved).toEqual({ ok: true, qid: parked[0]!.qid });

    await expect(pending).resolves.toEqual({
      kind: "answered",
      answer: "门确实坏了，按 95 通过即可。",
      qid: parked[0]!.qid,
    });
    expect(harness.registry.pendingFor(harness.runId)).toEqual([]);
  });

  it("askedAt 是提问那一刻的 epoch 毫秒，且事件与停驻记录共用同一个瞬间", async () => {
    const harness = makeHarness();
    const { port } = await harness.openAsk();

    const before = Date.now();
    void port.escalate(escalateRequest("现在几点？")).catch(() => {});
    const after = Date.now();

    const parked = harness.registry.pendingFor(harness.runId)[0]!;
    const event = harness.events[0] as { askedAt?: number };
    expect(parked.askedAt).toBeGreaterThanOrEqual(before);
    expect(parked.askedAt).toBeLessThanOrEqual(after);
    expect(event.askedAt).toBe(parked.askedAt);
  });

  it("context 一并停驻，空白 context 视同缺席", async () => {
    const harness = makeHarness();
    const { port } = await harness.openAsk();

    void port.escalate(escalateRequest("A?", "我试过把门槛调低但脚本是只读的")).catch(() => {});
    void port.escalate(escalateRequest("B?", "   ")).catch(() => {});

    const parked = harness.registry.pendingFor(harness.runId);
    expect(parked[0]?.context).toBe("我试过把门槛调低但脚本是只读的");
    expect(parked[1]).not.toHaveProperty("context");
  });

  it("Each ask can park at most 3 times; the 4th immediately returns an ordinary \"budget exhausted\" result", async () => {
    const harness = makeHarness();
    const { port } = await harness.openAsk();

    for (let index = 0; index < 3; index++) {
      void port.escalate(escalateRequest(`Issue ${index}`)).catch(() => {});
    }
    expect(harness.registry.pendingFor(harness.runId)).toHaveLength(3);

    const eventsBefore = harness.events.length;
    const fourth = await port.escalate(escalateRequest("问题 3"));

    expect(fourth).toMatchObject({ kind: "refused", reason: "budget_exhausted" });
    expect(fourth.kind === "refused" && fourth.message).toContain("at most 3 escalations");
    expect(harness.registry.pendingFor(harness.runId)).toHaveLength(3);
    expect(harness.events).toHaveLength(eventsBefore);
  });

  it("预算按 ask 归零，且换 ask 时撤下上一个 ask 的遗留停驻项", async () => {
    const harness = makeHarness();
    const { port, session } = await harness.openAsk();
    const first = [0, 1, 2].map((index) =>
      port.escalate(escalateRequest(`第One个 ask 的Issue ${index}`)),
    );
    await expect(port.escalate(escalateRequest("第 4 次"))).resolves.toMatchObject({
      reason: "budget_exhausted",
    });

    harness.driver.startAsk(session, { siteId: "ask#2", ordinal: 1 }, {
      instructions: "next",
      typed: false,
    });
    await expect(Promise.allSettled(first)).resolves.toMatchObject([
      { status: "rejected" },
      { status: "rejected" },
      { status: "rejected" },
    ]);
    expect(harness.registry.pendingFor(harness.runId)).toEqual([]);

    for (let index = 0; index < 3; index++) {
      void port.escalate(escalateRequest(`第Two个 ask 的Issue ${index}`)).catch(() => {});
    }
    expect(harness.registry.pendingFor(harness.runId)).toHaveLength(3);
    await expect(port.escalate(escalateRequest("又是第 4 次"))).resolves.toMatchObject({
      reason: "budget_exhausted",
    });
  });
});

describe("workflow escalation — actor 名", () => {
  it("Named actor\'s name enters park records and raised events end-to-end", async () => {
    const harness = makeHarness();
    const { port } = await harness.openAsk(1, { name: "poet", system: "你写诗。" });

    void port.escalate(escalateRequest("韵脚要不要押到底？")).catch(() => {});

    const parked = harness.registry.pendingFor(harness.runId)[0];
    expect(parked).toMatchObject({ actor: "actor#1@1", actorName: "poet" });
    expect(harness.events[0]).toMatchObject({
      type: "escalation-raised",
      actor: { siteId: "actor#1", ordinal: 1 },
      actorName: "poet",
    });
    const stored = harness.journal.listEvents(harness.runId, {
      types: "all",
      reportItems: "all",
    })[0];
    expect(stored?.event).toMatchObject({ actorName: "poet" });
  });

  it("匿名 actor 整个字段缺席，不合成任何兜底标签", async () => {
    const harness = makeHarness();
    const { port } = await harness.openAsk(1, { system: "你没有名字。" });

    void port.escalate(escalateRequest("我是谁？")).catch(() => {});

    const parked = harness.registry.pendingFor(harness.runId)[0];
    expect(parked).not.toHaveProperty("actorName");
    expect(parked?.actor).toBe("actor#1@1");
    expect(harness.events[0]).not.toHaveProperty("actorName");
  });

  it("Empty string name is treated as anonymous (verbatim consistent with engine\'s createActor criteria)", async () => {
    const harness = makeHarness();
    const { port } = await harness.openAsk(1, { name: "" });

    void port.escalate(escalateRequest("空名字算具名吗？")).catch(() => {});

    expect(harness.registry.pendingFor(harness.runId)[0]).not.toHaveProperty("actorName");
  });

  it("只有空白的名字**不**被 trim 成匿名：引擎认它具名、占缓存身份键，这里必须给同一个答案", async () => {
    const harness = makeHarness();
    const { port } = await harness.openAsk(1, { name: "  " });

    void port.escalate(escalateRequest("我叫两个空格。")).catch(() => {});

    expect(harness.registry.pendingFor(harness.runId)[0]?.actorName).toBe("  ");
  });
});

describe("workflow escalation — 取消", () => {
  it("cancelAsk 一并拒绝停驻中的升级 deferred，之后作答得到 run_not_in_flight", async () => {
    const harness = makeHarness();
    const { port, instance } = await harness.openAsk();

    const pending = port.escalate(escalateRequest("要不要跳过这个检查？"));
    const qid = harness.registry.pendingFor(harness.runId)[0]?.qid;
    expect(qid).toBeDefined();

    harness.driver.cancelAsk(instance);

    await expect(pending).rejects.toMatchObject({ code: "Cancelled" });
    expect(harness.registry.pendingFor(harness.runId)).toEqual([]);
    expect(harness.registry.resolve(qid!, "太晚了")).toMatchObject({
      ok: false,
      reason: "run_not_in_flight",
    });
  });

  it("cancelAsk 拒绝该会话上**全部**停驻项（一轮里并发升级过几次）", async () => {
    const harness = makeHarness();
    const { port, instance } = await harness.openAsk();

    const pendings = [0, 1, 2].map((index) => port.escalate(escalateRequest(`ConcurrencyIssue ${index}`)));
    expect(harness.registry.pendingFor(harness.runId)).toHaveLength(3);

    harness.driver.cancelAsk(instance);

    const settled = await Promise.allSettled(pendings);
    expect(settled.map((one) => one.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(harness.registry.pendingFor(harness.runId)).toEqual([]);
  });
});

describe("workflow escalation — qid 唯一性", () => {
  it("两个并发 run 共用一张表时 qid 互不碰撞（片段相同则自动加长）", async () => {
    const registry = createWorkflowEscalationRegistry();
    const left = makeHarness({ registry, runId: "dwfrun-abcdef01-aaaa" });
    const right = makeHarness({ registry, runId: "dwfrun-abcdef01-bbbb" });

    const leftAsk = await left.openAsk();
    const rightAsk = await right.openAsk();
    void leftAsk.port.escalate(escalateRequest("左边的问题")).catch(() => {});
    void rightAsk.port.escalate(escalateRequest("右边的问题")).catch(() => {});

    const leftQid = registry.pendingFor(left.runId)[0]?.qid;
    const rightQid = registry.pendingFor(right.runId)[0]?.qid;
    expect(leftQid).toBe("dwfq-abcdef01-1");
    expect(rightQid).toBe("dwfq-abcdef01-bbbb-1");
    expect(leftQid).not.toBe(rightQid);
  });

  it("同一个 run 内 seq 单调递增", async () => {
    const harness = makeHarness({ runId: "dwfrun-99887766-0000" });
    const { port } = await harness.openAsk();
    for (let index = 0; index < 3; index++) {
      void port.escalate(escalateRequest(`Issue ${index}`)).catch(() => {});
    }

    expect(harness.registry.pendingFor(harness.runId).map((one) => one.qid)).toEqual([
      "dwfq-99887766-1",
      "dwfq-99887766-2",
      "dwfq-99887766-3",
    ]);
  });
});

describe("workflow escalation — 事件双轨", () => {
  it("raised / resolved 两类事件同时落 journal 与 emit 轨，且顺序一致", async () => {
    const harness = makeHarness();
    const { port } = await harness.openAsk();

    const pending = port.escalate(escalateRequest("这个门是不是坏了？", "上下文若干"));
    const parked = harness.registry.pendingFor(harness.runId)[0]!;
    const qid = parked.qid;
    harness.registry.resolve(qid, "坏了，按 95 通过。");
    await pending;

    const raised = {
      type: "escalation-raised",
      qid,
      actor: { siteId: "actor#1", ordinal: 1 },
      question: "这个门是不是坏了？",
      context: "上下文若干",
      askedAt: parked.askedAt,
    };
    const resolved = { type: "escalation-resolved", qid, answer: "坏了，按 95 通过。" };

    expect(harness.events).toEqual([raised, resolved]);
    const stored = harness.journal.listEvents(harness.runId, { types: "all", reportItems: "all" });
    expect(stored.map((one) => one.event)).toEqual([raised, resolved]);
    expect(harness.journal.listNodes(harness.runId, { kinds: "all", withResult: true })).toEqual(
      [],
    );
  });

  it("Payload truncated at port\'s 2048-char boundary (oversized questions do not cross protocol boundary as-is)", async () => {
    const harness = makeHarness();
    const { port } = await harness.openAsk();
    const huge = "问".repeat(DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxStringLength + 500);

    void port.escalate(escalateRequest(huge)).catch(() => {});

    const stored = harness.journal.listEvents(harness.runId, { types: "all", reportItems: "all" });
    expect((stored[0]!.event as { question: string }).question).toHaveLength(huge.length);
    const projected = toProtocolEvent(stored[0]!.sequence, stored[0]!.event);
    expect(projected.type).toBe("escalation-raised");
    expect(projected.truncated).toBe(true);
    expect((projected.payload.question as string).length).toBe(
      DYNAMIC_WORKFLOW_RUN_EVENT_PAYLOAD_LIMITS.maxStringLength,
    );
  });
});

describe("workflow escalation — 注册表的结构化拒绝", () => {
  it("三类拒绝各自可分辨，且文案陈述现状", async () => {
    const harness = makeHarness();
    const { port, instance } = await harness.openAsk();

    const unknown = harness.registry.resolve("dwfq-nonesuch-9", "答案");
    expect(unknown).toMatchObject({ ok: false, reason: "unknown_question" });
    expect(unknown.ok === false && unknown.message).toContain("pendingQuestions");

    const answered = port.escalate(escalateRequest("第一个问题"));
    const firstQid = harness.registry.pendingFor(harness.runId)[0]!.qid;
    harness.registry.resolve(firstQid, "答案一");
    await answered;
    const again = harness.registry.resolve(firstQid, "答案二");
    expect(again).toMatchObject({ ok: false, reason: "already_resolved" });

    const withdrawn = port.escalate(escalateRequest("第二个问题"));
    const secondQid = harness.registry.pendingFor(harness.runId)[0]!.qid;
    harness.driver.cancelAsk(instance);
    await expect(withdrawn).rejects.toMatchObject({ code: "Cancelled" });
    expect(harness.registry.resolve(secondQid, "答案三")).toMatchObject({
      ok: false,
      reason: "run_not_in_flight",
    });
  });

  it("Withdrawal does not overwrite \"answered\": resolved qids still report already_resolved", async () => {
    const harness = makeHarness();
    const { port, instance } = await harness.openAsk();

    const answered = port.escalate(escalateRequest("问题"));
    const qid = harness.registry.pendingFor(harness.runId)[0]!.qid;
    harness.registry.resolve(qid, "答案");
    await answered;
    harness.driver.cancelAsk(instance);

    expect(harness.registry.resolve(qid, "再来一次")).toMatchObject({
      ok: false,
      reason: "already_resolved",
    });
  });

  it("pendingFor 按 run 隔离：一张表上的两个 run 各看各的", async () => {
    const registry = createWorkflowEscalationRegistry();
    const left = makeHarness({ registry, runId: "dwfrun-aaaa0000-1111" });
    const right = makeHarness({ registry, runId: "dwfrun-bbbb0000-2222" });
    const leftAsk = await left.openAsk();
    const rightAsk = await right.openAsk();

    void leftAsk.port.escalate(escalateRequest("左")).catch(() => {});
    void rightAsk.port.escalate(escalateRequest("右")).catch(() => {});

    expect(registry.pendingFor(left.runId).map((one) => one.question)).toEqual(["左"]);
    expect(registry.pendingFor(right.runId).map((one) => one.question)).toEqual(["右"]);
  });
});

// ————————————————————————————————————————————————
//
// ————————————————————————————————————————————————
describe("workflow escalation — actor 会话的工具面", () => {
  it("actor\'s tool surface removes ResolveWorkflowQuestion, but keeps escalate", () => {
    const policy = workflowActorToolPolicy();
    expect(policy.toolDisallowlist).toContain(RESOLVE_WORKFLOW_QUESTION_TOOL_NAME);
    expect(policy.toolDisallowlist).not.toContain(ESCALATE_TOOL_NAME);
  });
});
