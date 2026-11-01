import { describe, expect, it } from "vitest";
import type { EventId, SessionEvent, SessionId, TraceId } from "@origin-ai/cf-contracts";
import { SessionEventType } from "@origin-ai/cf-contracts";
import type {
  ConversationDelta,
  ConversationSnapshot,
  ConversationTopicFrame,
  WorkflowRunUpdatedDelta,
  WorkflowRunsState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  PROTOCOL_V4_LIMITS,
  WORKFLOW_RUNS_LEGACY_LIMITS,
  WORKFLOW_RUNS_LIMITS,
  applyConversationDeltas,
  clampWorkflowRunsForLegacy,
  conversationTopicFrameSchema,
  utf8JsonByteLength,
  workflowRunUpdateWithinWireBounds,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { ConversationTopicPublisher } from "../src/cf-protocol-v4/index.js";

const RUN_ID = "dwfrun-1";

const EVICTION_ROUNDS = 16;
const MODERN = "sub-epoch-1-1";
const LEGACY = "sub-epoch-1-2";

function upperBoundOf(publisher: ConversationTopicPublisher): number {
  return (publisher as unknown as { wireSnapshotBytesUpperBound: number })
    .wireSnapshotBytesUpperBound;
}

function pinUpperBoundToTruth(publisher: ConversationTopicPublisher): void {
  (publisher as unknown as { wireSnapshotBytesUpperBound: number }).wireSnapshotBytesUpperBound =
    publisher.getWireSnapshotLogicalBytes();
}

function snapshotOf(frame: ConversationTopicFrame | null): ConversationSnapshot {
  expect(frame?.payload.kind).toBe("snapshot");
  return (frame!.payload as { kind: "snapshot"; snapshot: ConversationSnapshot }).snapshot;
}

function deltasOf(frame: ConversationTopicFrame | null): ConversationDelta[] {
  expect(frame?.payload.kind).toBe("deltas");
  return (frame!.payload as { kind: "deltas"; deltas: ConversationDelta[] }).deltas;
}

function onlyUpdate(deltas: readonly ConversationDelta[]): WorkflowRunUpdatedDelta {
  expect(deltas.map((delta) => delta.op)).toEqual(["workflowRun.updated"]);
  return deltas[0] as WorkflowRunUpdatedDelta;
}

function withoutRemovals(deltas: readonly ConversationDelta[]): ConversationDelta[] {
  return deltas.map((delta) => {
    if (delta.op !== "workflowRun.updated") return delta;
    const { removedActors: _actors, removedNodes: _nodes, ...rest } = delta;
    return rest;
  });
}

interface EvictionScenario {
  events: readonly SessionEvent[];
  
  boundSamples: readonly { upper: number; exact: number }[];
  
  resumeSample: { upper: number; exact: number; before: number };
  modernBase: ConversationSnapshot;
  legacyBase: ConversationSnapshot;
  evictionModern: ConversationDelta[];
  evictionLegacy: ConversationDelta[];
  evictedRuns: WorkflowRunsState;
  resumeModern: ConversationDelta[];
  resumeLegacy: ConversationDelta[];
  resumedRuns: WorkflowRunsState;
}

let cached: EvictionScenario | undefined;

function scenario(): EvictionScenario {
  if (cached) return cached;
  const events: SessionEvent[] = [];
  const publisher = new ConversationTopicPublisher("session-1", "epoch-1", { now: () => 0 });
  const ingest = (type: SessionEventType, payload: unknown): void => {
    const event: SessionEvent = {
      id: `event-${events.length + 1}` as EventId,
      sessionId: "session-1" as SessionId,
      type,
      timestamp: new Date(1_700_000_000_000 + events.length * 1000),
      traceId: "trace-1" as TraceId,
      sequenceNumber: events.length + 1,
      payload,
    };
    events.push(event);
    publisher.ingest(event);
  };
  const progress = (eventType: string, payload: Record<string, unknown>): void => {
    ingest(SessionEventType.DynamicWorkflowRunProgress, {
      runId: RUN_ID,
      toolCallId: "tc-1",
      sequence: events.length,
      eventType,
      payload,
    });
  };
  
  const finishedGroup = (ordinal: number, phaseName: string): void => {
    const actor = { siteId: "agent#1", ordinal };
    const instance = { siteId: "ask#1", ordinal };
    progress("actor-created", { actor, name: `agent-${ordinal}`, phaseName });
    progress("node-queued", { instance, actor, kind: "ask", phaseName });
    progress("node-settled", { instance, outcome: "ok" });
  };

  ingest(SessionEventType.SessionCreated, { mode: "default", contextWindow: 200_000 });
  progress("run-started", { runId: RUN_ID });
  for (let ordinal = 1; ordinal <= WORKFLOW_RUNS_LIMITS.maxNodes; ordinal += 1) {
    finishedGroup(ordinal, `phase-${ordinal % 4}`);
  }

  const modernBase = snapshotOf(
    publisher.subscribe({ connectionId: "modern", workflowRunDeltas: true }).frame,
  );
  const legacyBase = snapshotOf(publisher.subscribe({ connectionId: "legacy" }).frame);

  const boundSamples: { upper: number; exact: number }[] = [];
  
  const sampled = (eventType: string, payload: Record<string, unknown>): void => {
    pinUpperBoundToTruth(publisher);
    progress(eventType, payload);
    boundSamples.push({
      upper: upperBoundOf(publisher),
      exact: publisher.getWireSnapshotLogicalBytes(),
    });
  };
  for (let round = 1; round <= EVICTION_ROUNDS; round += 1) {
    const ordinal = WORKFLOW_RUNS_LIMITS.maxNodes + round;
    const actor = { siteId: "agent#1", ordinal };
    sampled("actor-created", { actor, name: `agent-${ordinal}`, phaseName: "late" });
    sampled("node-queued", {
      instance: { siteId: "ask#1", ordinal },
      actor,
      kind: "ask",
      phaseName: "late",
    });
  }
  const evictionModern = deltasOf(publisher.flush(MODERN));
  const evictionLegacy = deltasOf(publisher.flush(LEGACY));
  const evictedRuns = publisher.getSnapshot().workflowRuns!;

  pinUpperBoundToTruth(publisher);
  const resumeExactBefore = publisher.getWireSnapshotLogicalBytes();
  progress("run-started", { runId: RUN_ID });
  const resumeSample = {
    upper: upperBoundOf(publisher),
    exact: publisher.getWireSnapshotLogicalBytes(),
    before: resumeExactBefore,
  };
  const resumeModern = deltasOf(publisher.flush(MODERN));
  const resumeLegacy = deltasOf(publisher.flush(LEGACY));
  const resumedRuns = publisher.getSnapshot().workflowRuns!;

  cached = {
    events,
    boundSamples,
    resumeSample,
    modernBase,
    legacyBase,
    evictionModern,
    evictionLegacy,
    evictedRuns,
    resumeModern,
    resumeLegacy,
    resumedRuns,
  };
  return cached;
}

describe("ingest 快路径 × 腾位", () => {
  
  it("真界 1024 上的每一次腾位：保守上界都不低于精确字节数", () => {
    const { boundSamples } = scenario();
    expect(boundSamples).toHaveLength(EVICTION_ROUNDS * 2);
    for (const sample of boundSamples) {
      expect(sample.upper).toBeGreaterThanOrEqual(sample.exact);
    }
    const slack = boundSamples.map((sample) => sample.upper - sample.exact);
    expect(Math.max(...slack)).toBeLessThan(2048);
  });

  
  it("重臂那一条 op：快照缩了，上界只会偏保守", () => {
    const { resumeSample } = scenario();
    expect(resumeSample.exact).toBeLessThan(resumeSample.before);
    expect(resumeSample.upper).toBeGreaterThanOrEqual(resumeSample.exact);
  });

  it("腾位的可观察面：两张表停在界上，被摘掉的条目仍然可数", () => {
    const run = scenario().evictedRuns.runs[0]!;
    expect(run.actors).toHaveLength(WORKFLOW_RUNS_LIMITS.maxActors);
    expect(run.nodes).toHaveLength(WORKFLOW_RUNS_LIMITS.maxNodes);
    expect(run.truncated).toBe(true);
    expect(run.usage.nodesUnlisted).toBe(EVICTION_ROUNDS);
    expect(run.usage.nodesUnlistedSettled).toBe(EVICTION_ROUNDS);
    const byPhase = run.unlistedByPhase ?? [];
    expect(byPhase.reduce((sum, bucket) => sum + bucket.actors, 0)).toBe(EVICTION_ROUNDS);
    expect(byPhase.some((bucket) => bucket.phaseName === "late")).toBe(false);
  });
});

describe("旧消费者 × 腾位", () => {
  
  it("After a batch of evictions, legacy subscribers\' final state = clampWorkflowRunsForLegacy(authoritative state)", () => {
    const { legacyBase, evictionLegacy, evictedRuns } = scenario();
    expect(evictionLegacy.map((delta) => delta.op)).toEqual(["state.updated"]);
    const settled = applyConversationDeltas(legacyBase, evictionLegacy);
    expect(JSON.stringify(settled.workflowRuns)).toBe(
      JSON.stringify(clampWorkflowRunsForLegacy(evictedRuns)),
    );
    const run = settled.workflowRuns!.runs[0]!;
    expect(run.actors).toHaveLength(WORKFLOW_RUNS_LEGACY_LIMITS.maxActors);
    expect(run.nodes).toHaveLength(WORKFLOW_RUNS_LEGACY_LIMITS.maxNodes);
    expect(run.nodes.filter((node) => node.phase !== "settled").length).toBe(EVICTION_ROUNDS);
  });

  it("增量订阅者施加同一批 op 之后与权威态逐字节一致", () => {
    const { modernBase, evictionModern, evictedRuns } = scenario();
    const op = onlyUpdate(evictionModern);
    expect(op.removedActors).toHaveLength(EVICTION_ROUNDS);
    expect(op.removedNodes).toHaveLength(EVICTION_ROUNDS);
    expect(workflowRunUpdateWithinWireBounds(op)).toBe(true);
    const settled = applyConversationDeltas(modernBase, evictionModern);
    expect(JSON.stringify(settled.workflowRuns)).toBe(JSON.stringify(evictedRuns));

    const dropped = applyConversationDeltas(modernBase, withoutRemovals(evictionModern));
    expect(dropped.workflowRuns!.runs[0]!.actors).toHaveLength(
      WORKFLOW_RUNS_LIMITS.maxActors + EVICTION_ROUNDS,
    );
    expect(JSON.stringify(dropped.workflowRuns)).not.toBe(JSON.stringify(evictedRuns));
  });
});

describe("重臂：一条 op 清空两张表", () => {
  
  it("1024 + 1024 条删除仍在 wire 与订阅者两道兜底之内", () => {
    const { resumeModern } = scenario();
    const op = onlyUpdate(resumeModern);
    expect(op.removedActors).toHaveLength(WORKFLOW_RUNS_LIMITS.maxActors);
    expect(op.removedNodes).toHaveLength(WORKFLOW_RUNS_LIMITS.maxNodes);
    expect(op.cleared).toContain("unlistedByPhase");
    expect(workflowRunUpdateWithinWireBounds(op)).toBe(true);
    expect(() =>
      conversationTopicFrameSchema.parse({
        topic: "conversation/session-1",
        subscriptionId: MODERN,
        fromSeq: 0,
        toSeq: 1,
        sentAt: 0,
        payload: { kind: "deltas", deltas: resumeModern },
      }),
    ).not.toThrow();
    expect(resumeModern.length).toBeLessThan(PROTOCOL_V4_LIMITS.subscriberBufferMaxOps);
    expect(utf8JsonByteLength({ kind: "deltas", deltas: resumeModern })).toBeLessThan(
      PROTOCOL_V4_LIMITS.subscriberBufferMaxBytes,
    );
  });

  it("两种订阅者各自施加之后都落在空表上", () => {
    const {
      modernBase,
      evictionModern,
      resumeModern,
      legacyBase,
      evictionLegacy,
      resumeLegacy,
      resumedRuns,
    } = scenario();
    const modern = applyConversationDeltas(
      applyConversationDeltas(modernBase, evictionModern),
      resumeModern,
    );
    expect(JSON.stringify(modern.workflowRuns)).toBe(JSON.stringify(resumedRuns));
    expect(modern.workflowRuns!.runs[0]!.actors).toHaveLength(0);
    expect(modern.workflowRuns!.runs[0]!.nodes).toHaveLength(0);
    const dropped = applyConversationDeltas(
      applyConversationDeltas(modernBase, evictionModern),
      withoutRemovals(resumeModern),
    );
    expect(dropped.workflowRuns!.runs[0]!.nodes).toHaveLength(WORKFLOW_RUNS_LIMITS.maxNodes);

    const legacy = applyConversationDeltas(
      applyConversationDeltas(legacyBase, evictionLegacy),
      resumeLegacy,
    );
    expect(JSON.stringify(legacy.workflowRuns)).toBe(
      JSON.stringify(clampWorkflowRunsForLegacy(resumedRuns)),
    );
  });

  
  it("冷重物化同一段日志：终态与逐事件 live 逐字节一致", () => {
    const { events, resumedRuns } = scenario();
    const rehydrated = new ConversationTopicPublisher("session-1", "epoch-1", { now: () => 0 });
    rehydrated.rehydrate(events);
    expect(JSON.stringify(rehydrated.getSnapshot().workflowRuns)).toBe(JSON.stringify(resumedRuns));
    expect(upperBoundOf(rehydrated)).toBeGreaterThanOrEqual(
      rehydrated.getWireSnapshotLogicalBytes(),
    );
  });
});
