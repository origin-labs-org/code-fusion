import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  EventId,
  SessionEvent,
  SessionEventType as SessionEventTypeUnion,
  SessionId,
  TraceId,
} from "@origin-ai/cf-contracts";
import { SessionEventType } from "@origin-ai/cf-contracts";
import type {
  ConversationDelta,
  ConversationSnapshot,
  ConversationTopicFrame,
  WorkflowRunsState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  PROTOCOL_V4_LIMITS,
  WORKFLOW_RUNS_LEGACY_LIMITS,
  WORKFLOW_RUNS_LIMITS,
  applyConversationDeltas,
  conversationTopicFrameSchema,
  workflowRunActorSchema,
  workflowRunNodeSchema,
  workflowRunSchema,
  workflowRunsStateSchema,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  ConversationTopicPublisher,
  PROJECTION_TERMINAL_RESERVE_BYTES,
  ProductProjection,
} from "../src/cf-protocol-v4/index.js";

const RUN_ID = "dwfrun-1";

const legacyWorkflowRunsStateSchema = workflowRunsStateSchema.extend({
  runs: z
    .array(
      workflowRunSchema.extend({
        actors: z.array(workflowRunActorSchema).max(WORKFLOW_RUNS_LEGACY_LIMITS.maxActors),
        nodes: z.array(workflowRunNodeSchema).max(WORKFLOW_RUNS_LEGACY_LIMITS.maxNodes),
      }),
    )
    .max(WORKFLOW_RUNS_LIMITS.maxRuns),
});

class EventLog {
  private seq = 0;
  private progressSequence = -1;
  readonly events: SessionEvent[] = [];

  push(type: SessionEventTypeUnion, payload: unknown): SessionEvent {
    this.seq += 1;
    const event: SessionEvent = {
      id: `event-${this.seq}` as EventId,
      sessionId: "session-1" as SessionId,
      type,
      timestamp: new Date(1_700_000_000_000 + this.seq * 1000),
      traceId: "trace-1" as TraceId,
      sequenceNumber: this.seq,
      payload,
    };
    this.events.push(event);
    return event;
  }

  progress(eventType: string, payload: Record<string, unknown>): SessionEvent {
    this.progressSequence += 1;
    return this.push(SessionEventType.DynamicWorkflowRunProgress, {
      runId: RUN_ID,
      toolCallId: "tc-1",
      sequence: this.progressSequence,
      eventType,
      payload,
    });
  }

  started(): SessionEvent {
    this.push(SessionEventType.SessionCreated, { mode: "default", contextWindow: 200_000 });
    return this.progress("run-started", { runId: RUN_ID, caps: { maxConcurrency: 4 } });
  }

  
  fanOut(count: number): void {
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      this.progress("node-queued", { instance: { siteId: "ask#1", ordinal }, kind: "ask" });
    }
  }
}

function publisherWith(events: readonly SessionEvent[]): ConversationTopicPublisher {
  const publisher = new ConversationTopicPublisher("session-1", "epoch-1", { now: () => 0 });
  for (const event of events) publisher.ingest(event);
  return publisher;
}

function snapshotOf(frame: ConversationTopicFrame | null): ConversationSnapshot {
  expect(frame?.payload.kind).toBe("snapshot");
  return (frame!.payload as { kind: "snapshot"; snapshot: ConversationSnapshot }).snapshot;
}

function deltasOf(frame: ConversationTopicFrame | null): ConversationDelta[] {
  expect(frame?.payload.kind).toBe("deltas");
  return (frame!.payload as { kind: "deltas"; deltas: ConversationDelta[] }).deltas;
}

describe("每订阅者编码：增量 vs 旧消费者", () => {
  it("同一批事件：认得增量的连接收 workflowRun.*，旧连接收一条整键 patch", () => {
    const log = new EventLog();
    log.started();
    const publisher = publisherWith(log.events);
    publisher.subscribe({ connectionId: "modern", workflowRunDeltas: true });
    publisher.subscribe({ connectionId: "legacy" });

    publisher.ingest(log.progress("node-queued", { instance: { siteId: "ask#1", ordinal: 1 } }));
    publisher.ingest(
      log.progress("node-dispatched", { instance: { siteId: "ask#1", ordinal: 1 } }),
    );

    const modern = deltasOf(publisher.flush("sub-epoch-1-1"));
    const legacy = deltasOf(publisher.flush("sub-epoch-1-2"));

    expect(modern.map((delta) => delta.op)).toEqual(["workflowRun.updated"]);
    expect((modern[0] as { runId: string }).runId).toBe(RUN_ID);
    expect(legacy.map((delta) => delta.op)).toEqual(["state.updated"]);
    expect(
      (legacy[0] as { patch: { workflowRuns?: WorkflowRunsState } }).patch.workflowRuns?.runs[0]
        ?.nodes,
    ).toHaveLength(1);
  });

  it("Legacy subscribers\' **snapshot** frame clamped to legacy bounds and set to truncated; incremental subscribers get full data", () => {
    const log = new EventLog();
    log.started();
    log.fanOut(WORKFLOW_RUNS_LEGACY_LIMITS.maxNodes + 44);
    const publisher = publisherWith(log.events);

    const modern = snapshotOf(
      publisher.subscribe({ connectionId: "modern", workflowRunDeltas: true }).frame,
    );
    const legacy = snapshotOf(publisher.subscribe({ connectionId: "legacy" }).frame);

    expect(modern.workflowRuns?.runs[0]?.nodes).toHaveLength(
      WORKFLOW_RUNS_LEGACY_LIMITS.maxNodes + 44,
    );
    expect(modern.workflowRuns?.runs[0]?.truncated).toBeUndefined();
    expect(legacy.workflowRuns?.runs[0]?.nodes).toHaveLength(WORKFLOW_RUNS_LEGACY_LIMITS.maxNodes);
    expect(legacy.workflowRuns?.runs[0]?.truncated).toBe(true);

    expect(legacyWorkflowRunsStateSchema.safeParse(legacy.workflowRuns).success).toBe(true);
    expect(legacyWorkflowRunsStateSchema.safeParse(modern.workflowRuns).success).toBe(false);
  });

  it("Legacy subscribers\' resume replay: historical increments in log folded into a single **current** full-key patch", () => {
    const log = new EventLog();
    log.started();
    const publisher = publisherWith(log.events);
    const base = { logEpoch: "epoch-1", seq: publisher.getSnapshot().seq };
    log.fanOut(12);
    for (const event of log.events.slice(-12)) publisher.ingest(event);

    const legacy = deltasOf(publisher.subscribe({ connectionId: "legacy", base }).frame);
    expect(legacy.map((delta) => delta.op)).toEqual(["state.updated"]);
    const patched = (legacy[0] as { patch: { workflowRuns?: WorkflowRunsState } }).patch
      .workflowRuns;
    expect(patched?.runs[0]?.nodes).toHaveLength(12);
    expect(patched?.revision).toBe(publisher.getSnapshot().workflowRuns?.revision);

    const modern = deltasOf(
      publisher.subscribe({ connectionId: "modern", base, workflowRunDeltas: true }).frame,
    );
    expect(modern.map((delta) => delta.op)).toEqual(["workflowRun.updated"]);
    expect((modern[0] as { nodes?: unknown[] }).nodes).toHaveLength(12);
  });

  it("Snapshots sent on overflow degradation are also cropped by subscriber (legacy subscribers\' recovery path cannot be wider instead)", () => {
    const log = new EventLog();
    log.started();
    log.fanOut(WORKFLOW_RUNS_LEGACY_LIMITS.maxNodes + 8);
    const publisher = publisherWith(log.events);
    publisher.subscribe({ connectionId: "legacy" });
    const recovered = snapshotOf(publisher.resync("sub-epoch-1-1"));
    expect(recovered.workflowRuns?.runs[0]?.nodes).toHaveLength(
      WORKFLOW_RUNS_LEGACY_LIMITS.maxNodes,
    );
    expect(legacyWorkflowRunsStateSchema.safeParse(recovered.workflowRuns).success).toBe(true);
  });
});

describe("扇出宽度与订阅者 op 上界", () => {
  
  it("一个 flush 窗口内 600 路 fan-out：增量订阅者的 op 数远低于 500 硬上界", () => {
    const log = new EventLog();
    log.started();
    const publisher = publisherWith(log.events);
    publisher.subscribe({ connectionId: "modern", workflowRunDeltas: true });
    publisher.flush("sub-epoch-1-1");

    log.fanOut(600);
    for (const event of log.events.slice(-600)) publisher.ingest(event);

    const frame = publisher.flush("sub-epoch-1-1");
    const deltas = deltasOf(frame);
    expect(deltas.length).toBeLessThan(10);
    expect(deltas.length).toBeLessThan(PROTOCOL_V4_LIMITS.subscriberBufferMaxOps);
    expect(() => conversationTopicFrameSchema.parse(frame)).not.toThrow();
    expect(publisher.getSnapshot().workflowRuns?.runs[0]?.nodes).toHaveLength(600);
  });
});

describe("ingest 快路径", () => {
  
  function upperBoundOf(publisher: ConversationTopicPublisher): number {
    return (publisher as unknown as { wireSnapshotBytesUpperBound: number })
      .wireSnapshotBytesUpperBound;
  }

  function setUpperBound(publisher: ConversationTopicPublisher, value: number): void {
    (publisher as unknown as { wireSnapshotBytesUpperBound: number }).wireSnapshotBytesUpperBound =
      value;
  }

  
  function spyOnExactMeasurement(publisher: ConversationTopicPublisher) {
    return vi.spyOn(
      publisher as unknown as {
        measureWireSnapshotBytes: (snapshot: ConversationSnapshot) => number;
      },
      "measureWireSnapshotBytes",
    );
  }

  it("只产键级增量的事件不再量整份快照", () => {
    const log = new EventLog();
    log.started();
    const publisher = publisherWith(log.events);
    const measure = spyOnExactMeasurement(publisher);

    publisher.ingest(log.progress("node-queued", { instance: { siteId: "ask#1", ordinal: 1 } }));
    publisher.ingest(
      log.progress("node-dispatched", { instance: { siteId: "ask#1", ordinal: 1 } }),
    );

    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
  });

  
  it("幂等重放一条都不产 delta，同样不量整份快照", () => {
    const log = new EventLog();
    log.started();
    const queued = log.progress("node-queued", { instance: { siteId: "ask#1", ordinal: 1 } });
    const publisher = publisherWith([...log.events]);
    const measure = spyOnExactMeasurement(publisher);

    publisher.ingest(queued);

    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
    expect(publisher.getSnapshot().workflowRuns?.runs[0]?.nodes).toHaveLength(1);
  });

  
  it("非 dwf 的零 delta 事件同样不量整份快照", () => {
    const publisher = new ConversationTopicPublisher("session-1", "epoch-1", { now: () => 0 });
    const log = new EventLog();
    const measure = spyOnExactMeasurement(publisher);

    const created = log.push(SessionEventType.SessionCreated, {
      mode: "default",
      contextWindow: 200_000,
    });
    publisher.ingest(created);

    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
    expect(upperBoundOf(publisher)).toBeGreaterThanOrEqual(publisher.getWireSnapshotLogicalBytes());
  });

  it("非 dwf 事件仍走精确路径，并把保守上界重置回精确值", () => {
    const log = new EventLog();
    log.started();
    const publisher = publisherWith(log.events);
    publisher.ingest(log.progress("node-queued", { instance: { siteId: "ask#1", ordinal: 1 } }));
    const measure = spyOnExactMeasurement(publisher);

    publisher.ingest(
      log.push(SessionEventType.SessionTitleUpdated, { title: "重置一下上界", source: "user" }),
    );

    expect(measure).toHaveBeenCalled();
    measure.mockRestore();
    expect(upperBoundOf(publisher)).toBe(publisher.getWireSnapshotLogicalBytes());
  });

  
  it("一串快路径事件之后，保守上界仍不低于精确字节数", () => {
    const log = new EventLog();
    log.started();
    const publisher = publisherWith(log.events);
    log.fanOut(120);
    for (const event of log.events.slice(-120)) publisher.ingest(event);
    for (let ordinal = 1; ordinal <= 120; ordinal += 1) {
      publisher.ingest(
        log.progress("node-settled", { instance: { siteId: "ask#1", ordinal }, outcome: "ok" }),
      );
    }

    const exact = publisher.getWireSnapshotLogicalBytes();
    expect(exact).toBeGreaterThan(0);
    expect(upperBoundOf(publisher)).toBeGreaterThanOrEqual(exact);
  });

  
  it("上界漂到闸门边上时下一条事件精确重测并收回，不误判超限", () => {
    const log = new EventLog();
    log.started();
    const publisher = publisherWith(log.events);
    log.fanOut(20);
    for (const event of log.events.slice(-20)) publisher.ingest(event);
    const exact = publisher.getWireSnapshotLogicalBytes();

    setUpperBound(
      publisher,
      PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxBytes - PROJECTION_TERMINAL_RESERVE_BYTES - 8,
    );
    const measure = spyOnExactMeasurement(publisher);
    expect(() =>
      publisher.ingest(
        log.progress("node-dispatched", { instance: { siteId: "ask#1", ordinal: 1 } }),
      ),
    ).not.toThrow();

    expect(measure).toHaveBeenCalledTimes(1);
    measure.mockRestore();
    const corrected = upperBoundOf(publisher);
    expect(corrected).toBe(publisher.getWireSnapshotLogicalBytes());
    expect(corrected).toBeLessThan(exact + 4096);
  });
});

describe("冷重物化", () => {
  
  it("批量重放一串 dwf 事件：走批量路径，终态与逐事件 live 一致", () => {
    const log = new EventLog();
    log.started();
    log.fanOut(40);
    for (let ordinal = 1; ordinal <= 40; ordinal += 1) {
      log.progress("node-settled", { instance: { siteId: "ask#1", ordinal }, outcome: "ok" });
    }

    const live = publisherWith(log.events);
    const rehydrated = new ConversationTopicPublisher("session-1", "epoch-1", { now: () => 0 });
    rehydrated.rehydrate(log.events);

    expect(JSON.stringify(rehydrated.getSnapshot().workflowRuns)).toBe(
      JSON.stringify(live.getSnapshot().workflowRuns),
    );
    const ack = rehydrated.subscribe({
      connectionId: "after-batch",
      base: { logEpoch: "epoch-1", seq: 2 },
      workflowRunDeltas: true,
    }).ack;
    expect(ack.mode).toBe("snapshot");
  });
});

describe("snapshot(W) + 续流 ≡ 全量重放（带键级增量）", () => {
  function authoritative(events: readonly SessionEvent[]): ConversationSnapshot {
    const projection = new ProductProjection("session-1", "epoch-1");
    for (const event of events) projection.applyEvent(event);
    return projection.getSnapshot();
  }

  it("两种订阅者各自的中间帧不同，终态 workflowRuns 逐字节一致", () => {
    const log = new EventLog();
    log.started();
    log.fanOut(30);
    const prefix = log.events.length;
    const publisher = publisherWith(log.events);

    const modernStore = {
      snapshot: snapshotOf(
        publisher.subscribe({ connectionId: "modern", workflowRunDeltas: true }).frame,
      ),
    };
    const legacyStore = {
      snapshot: snapshotOf(publisher.subscribe({ connectionId: "legacy" }).frame),
    };

    for (let ordinal = 1; ordinal <= 30; ordinal += 1) {
      log.progress("node-settled", { instance: { siteId: "ask#1", ordinal }, outcome: "ok" });
    }
    for (const event of log.events.slice(prefix)) publisher.ingest(event);

    modernStore.snapshot = applyConversationDeltas(
      modernStore.snapshot,
      deltasOf(publisher.flush("sub-epoch-1-1")),
    );
    legacyStore.snapshot = applyConversationDeltas(
      legacyStore.snapshot,
      deltasOf(publisher.flush("sub-epoch-1-2")),
    );

    const replayed = authoritative(log.events).workflowRuns;
    expect(JSON.stringify(modernStore.snapshot.workflowRuns)).toBe(JSON.stringify(replayed));
    expect(JSON.stringify(legacyStore.snapshot.workflowRuns)).toBe(JSON.stringify(replayed));
  });
});
