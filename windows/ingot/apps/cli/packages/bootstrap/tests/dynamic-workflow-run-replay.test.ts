//
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteSessionStore, type DwfRunSessionListItem } from "@origin-ai/cf-adapters/storage";
import type { JournalStorePort, RunEvent } from "@origin-ai/cf-dynamic-workflow";
import { reduceWorkflowRunsState, type WorkflowRunsState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { toProgressPayload } from "../src/app/dynamic-workflow-run-launch.js";
import { replayRunProgress } from "../src/app/dynamic-workflow-run-replay.js";
import { mintActorSessionId } from "../src/app/workflow-driver.js";
import { resolveDynamicWorkflowJournalStore } from "../src/app/dynamic-workflow-run-service.js";

const PARENT = "sess_replay_parent";
const CEILING = 6;

type Journal = JournalStorePort & {
  listRunsByParentSession(parentSessionId: string, limit: number): DwfRunSessionListItem[];
};

let tempRoot: string;
let store: Awaited<ReturnType<typeof createSqliteSessionStore>>;
let journal: Journal;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-replay-"));
  store = await createSqliteSessionStore({ dbPath: join(tempRoot, "session.sqlite") });
  const resolved = resolveDynamicWorkflowJournalStore(store as never);
  if (resolved === undefined) throw new Error("sqlite store must expose the dwf journal");
  journal = resolved as Journal;
});

afterEach(async () => {
  await store.close?.();
  await rm(tempRoot, { force: true, recursive: true });
});

function createRun(runId: string): void {
  journal.createRun({
    runId,
    parentSessionId: PARENT,
    cwd: "/repo",
    toolCallId: `call-${runId}`,
    scriptText: "const a = agent('a');",
    scriptHash: "sha-a",
    caps: { maxConcurrency: 4 },
    spentTokens: 0,
    status: "running",
  });
  journal.appendEvent(runId, {
    type: "run-started",
    runId,
    caps: { maxConcurrency: 4 },
  } as RunEvent);
  journal.appendEvent(runId, {
    type: "actor-created",
    actor: { siteId: "actor#1", ordinal: 1 },
    name: "a",
  } as RunEvent);
}

function appendLegacySettle(runId: string, status: "cancelled" | "failed", error?: unknown): void {
  journal.appendEvent(runId, {
    type: "run-settled",
    status,
    ...(error === undefined ? {} : { error }),
  } as unknown as RunEvent);
}

function rowOf(runId: string): DwfRunSessionListItem {
  const row = journal.listRunsByParentSession(PARENT, 8).find((item) => item.runId === runId);
  if (row === undefined) throw new Error(`row missing for ${runId}`);
  return row;
}

function reduce(runId: string): WorkflowRunsState["runs"][number] {
  let state: WorkflowRunsState | undefined;
  for (const payload of replayRunProgress(rowOf(runId), journal, CEILING)) {
    state = reduceWorkflowRunsState(state, payload) ?? state;
  }
  const run = state?.runs.find((item) => item.runId === runId);
  if (run === undefined) throw new Error("run not projected");
  return run;
}

describe("replayRunProgress — 结算按行铸造", () => {
  it("旧词表 run-settled{cancelled}（行已译成 stopped）→ 回放尾部是行铸的 stopped，reducer 落终态且可恢复", () => {
    createRun("dwfrun-legacy-cancelled");
    appendLegacySettle("dwfrun-legacy-cancelled", "cancelled");
    journal.updateRunStatus("dwfrun-legacy-cancelled", "stopped", { stopReason: "user" });

    const payloads = replayRunProgress(rowOf("dwfrun-legacy-cancelled"), journal, CEILING);
    const stored = journal.listEvents("dwfrun-legacy-cancelled", {
      types: "all",
      reportItems: "all",
    });
    expect(payloads).toHaveLength(stored.length);
    const last = payloads.at(-1);
    expect(last).toMatchObject({
      eventType: "run-settled",
      sequence: stored.at(-1)?.sequence,
      payload: { status: "stopped", stopReason: "user", resumable: true },
    });
    expect(
      payloads.some((payload) => (payload.payload as { status?: unknown }).status === "cancelled"),
    ).toBe(false);

    const run = reduce("dwfrun-legacy-cancelled");
    expect(run.status).toBe("stopped");
    expect(run.stopReason).toBe("user");
    expect(run.resumable).toBe(true);
  });

  it("旧词表 run-settled{failed}（行是 errored）→ errored，失败文案来自行", () => {
    createRun("dwfrun-legacy-failed");
    appendLegacySettle("dwfrun-legacy-failed", "failed", { code: "DriverError", message: "boom" });
    journal.updateRunStatus("dwfrun-legacy-failed", "errored", {
      failure: { code: "DriverError", message: "boom" },
    });

    const run = reduce("dwfrun-legacy-failed");
    expect(run.status).toBe("errored");
    expect(run.error).toBe("boom");
    expect(run.resumable).toBeUndefined();
  });

  it("当前词表：行铸的结算与存着的那条逐字节相同（live 与冷回放同一份字节的契约不变）", () => {
    createRun("dwfrun-current");
    journal.updateRunStatus("dwfrun-current", "stopped", { stopReason: "model" });
    journal.appendEvent("dwfrun-current", {
      type: "run-settled",
      status: "stopped",
      stopReason: "model",
    } as RunEvent);

    const row = rowOf("dwfrun-current");
    const live = journal
      .listEvents("dwfrun-current", { types: "all", reportItems: "all" })
      .map((entry) =>
        toProgressPayload({
          event: entry.event,
          runId: row.runId,
          sequence: entry.sequence,
          toolCallId: row.toolCallId!,
          concurrencyCeiling: CEILING,
        }),
      );
    expect(JSON.stringify(replayRunProgress(row, journal, CEILING))).toBe(JSON.stringify(live));
  });

  it("行是终态而事件流没有结算（孤儿收敛只改了行）→ 追加一条 interrupted 结算，sequence = 最后一条 + 1", () => {
    createRun("dwfrun-orphan");
    journal.updateRunStatus("dwfrun-orphan", "stopped", {
      stopReason: "interrupted",
      failure: { code: "Interrupted", message: "owner exited" },
    });

    const stored = journal.listEvents("dwfrun-orphan", { types: "all", reportItems: "all" });
    const payloads = replayRunProgress(rowOf("dwfrun-orphan"), journal, CEILING);
    expect(payloads).toHaveLength(stored.length + 1);
    expect(payloads.at(-1)).toMatchObject({
      eventType: "run-settled",
      sequence: (stored.at(-1)?.sequence ?? 0) + 1,
      payload: { status: "stopped", stopReason: "interrupted", resumable: true },
    });
    expect(reduce("dwfrun-orphan").status).toBe("stopped");
  });

  it("中途的上一世结算（cancel → resume）原样保留，只替换尾部那条", () => {
    createRun("dwfrun-resumed");
    appendLegacySettle("dwfrun-resumed", "cancelled");
    journal.appendEvent("dwfrun-resumed", {
      type: "run-started",
      runId: "dwfrun-resumed",
      caps: { maxConcurrency: 4 },
    } as RunEvent);
    journal.updateRunStatus("dwfrun-resumed", "completed");
    journal.appendEvent("dwfrun-resumed", { type: "run-settled", status: "completed" } as RunEvent);

    const payloads = replayRunProgress(rowOf("dwfrun-resumed"), journal, CEILING);
    const settles = payloads.filter((payload) => payload.eventType === "run-settled");
    expect(settles.map((payload) => (payload.payload as { status: string }).status)).toEqual([
      "cancelled",
      "completed",
    ]);
    expect(reduce("dwfrun-resumed").status).toBe("completed");
  });

  it("run-launched 上的 subagentModel 进 run-started 载荷；冷回放与 live 逐字节相等", () => {
    const SUBAGENT = "zhipu/glm-5.3-flash$high";
    createRun("dwfrun-subagent");
    journal.appendEvent("dwfrun-subagent", {
      type: "run-launched",
      inputId: "input-origin",
      subagentModel: SUBAGENT,
    } as RunEvent);
    journal.updateRunStatus("dwfrun-subagent", "completed");
    journal.appendEvent("dwfrun-subagent", {
      type: "run-settled",
      status: "completed",
    } as RunEvent);

    const row = rowOf("dwfrun-subagent");
    const payloads = replayRunProgress(row, journal, CEILING);
    const started = payloads.find((payload) => payload.eventType === "run-started");
    expect(started?.payload).toMatchObject({
      subagentModel: SUBAGENT,
      concurrencyCeiling: CEILING,
    });
    for (const payload of payloads) {
      if (payload.eventType === "run-started" || payload.eventType === "run-launched") continue;
      expect("subagentModel" in payload.payload).toBe(false);
    }

    const live = journal
      .listEvents("dwfrun-subagent", { types: "all", reportItems: "all" })
      .map((entry) =>
        toProgressPayload({
          event: entry.event,
          runId: row.runId,
          sequence: entry.sequence,
          toolCallId: row.toolCallId!,
          launchInputId: "input-origin",
          concurrencyCeiling: CEILING,
          subagentModel: SUBAGENT,
        }),
      );
    expect(JSON.stringify(payloads)).toBe(JSON.stringify(live));
  });

  it("run-launched 没带子代理模型：run-started 载荷整个不带这个键", () => {
    createRun("dwfrun-no-subagent");
    journal.appendEvent("dwfrun-no-subagent", {
      type: "run-launched",
      inputId: "input-origin",
    } as RunEvent);
    const started = replayRunProgress(rowOf("dwfrun-no-subagent"), journal, CEILING).find(
      (payload) => payload.eventType === "run-started",
    );
    expect("subagentModel" in started!.payload).toBe(false);
  });

  it("actor-created payload\'s derived model comes from run-launched binding table; cold replay and live are byte-for-byte equal", () => {
    const BINDINGS = { "GLM-5.3-Flash": "zhipu/GLM-5.3-Flash" };
    createRun("dwfrun-bindings");
    journal.appendEvent("dwfrun-bindings", {
      type: "run-launched",
      inputId: "input-origin",
      modelBindings: BINDINGS,
    } as RunEvent);
    journal.appendEvent("dwfrun-bindings", {
      type: "actor-created",
      actor: { siteId: "actor#7", ordinal: 1 },
      name: "评审员",
      persona: { name: "评审员", model: "GLM-5.3-Flash" },
    } as RunEvent);
    journal.appendEvent("dwfrun-bindings", {
      type: "actor-created",
      actor: { siteId: "actor#8", ordinal: 1 },
      name: "旁观者",
      persona: { name: "旁观者" },
    } as RunEvent);

    const row = rowOf("dwfrun-bindings");
    const payloads = replayRunProgress(row, journal, CEILING);
    const created = payloads.filter(
      (payload) =>
        payload.eventType === "actor-created" &&
        ["评审员", "旁观者"].includes(String(payload.payload.name)),
    );
    expect(created[0]?.payload).toMatchObject({ model: "zhipu/GLM-5.3-Flash" });
    expect("model" in created[1]!.payload).toBe(false);

    const live = journal
      .listEvents("dwfrun-bindings", { types: "all", reportItems: "all" })
      .map((entry) =>
        toProgressPayload({
          event: entry.event,
          runId: row.runId,
          sequence: entry.sequence,
          toolCallId: row.toolCallId!,
          launchInputId: "input-origin",
          concurrencyCeiling: CEILING,
          modelBindings: BINDINGS,
        }),
      );
    expect(JSON.stringify(payloads)).toBe(JSON.stringify(live));
  });

  it("ask\'s node-dispatched carries birth facts and actorSessionId; cold replay and live are byte-for-byte equal", () => {
    const actor = { siteId: "actor#1", ordinal: 1 };
    createRun("dwfrun-dispatch");
    journal.appendEvent("dwfrun-dispatch", {
      type: "node-dispatched",
      instance: { siteId: "ask#1", ordinal: 1 },
      kind: "ask",
      actor,
      actorName: "planner",
      actorPhaseName: "Prepare",
      phaseName: "Work",
      instructionsHead: "写一份调研大纲",
    } as RunEvent);
    journal.appendEvent("dwfrun-dispatch", {
      type: "node-dispatched",
      instance: { siteId: "world-read#1", ordinal: 1 },
    } as RunEvent);

    const row = rowOf("dwfrun-dispatch");
    const payloads = replayRunProgress(row, journal, CEILING);
    const [ask, world] = payloads.filter((payload) => payload.eventType === "node-dispatched");
    expect(ask).toMatchObject({
      actorSessionId: mintActorSessionId("dwfrun-dispatch", actor),
      payload: {
        instance: { siteId: "ask#1", ordinal: 1 },
        kind: "ask",
        actor,
        actorName: "planner",
        actorPhaseName: "Prepare",
        phaseName: "Work",
        instructionsHead: "写一份调研大纲",
      },
    });
    const created = payloads.find((payload) => payload.eventType === "actor-created");
    expect(ask?.actorSessionId).toBe(created?.actorSessionId);
    expect(world).toMatchObject({ payload: { instance: { siteId: "world-read#1", ordinal: 1 } } });
    expect("actorSessionId" in world!).toBe(false);

    const live = journal
      .listEvents("dwfrun-dispatch", { types: "all", reportItems: "all" })
      .map((entry) =>
        toProgressPayload({
          event: entry.event,
          runId: row.runId,
          sequence: entry.sequence,
          toolCallId: row.toolCallId!,
          concurrencyCeiling: CEILING,
        }),
      );
    expect(JSON.stringify(payloads)).toBe(JSON.stringify(live));
  });

  it("ask\'s cached settlement carries birth facts and actorSessionId; world and live settlements are not backfilled; cold replay and live are byte-for-byte equal", () => {
    const actor = { siteId: "actor#1", ordinal: 1 };
    createRun("dwfrun-cached");
    journal.appendEvent("dwfrun-cached", {
      type: "node-settled",
      instance: { siteId: "ask#1", ordinal: 1 },
      outcome: "ok",
      cached: true,
      kind: "ask",
      actor,
      actorSeq: 0,
      instructionsHead: "调研",
      sourceSessionId: "sess-predecessor",
    } as RunEvent);
    journal.appendEvent("dwfrun-cached", {
      type: "node-settled",
      instance: { siteId: "ask#2", ordinal: 1 },
      outcome: "ok",
      cached: true,
      kind: "ask",
      actor,
      actorSeq: 1,
    } as RunEvent);
    journal.appendEvent("dwfrun-cached", {
      type: "node-settled",
      instance: { siteId: "world-read#1", ordinal: 1 },
      outcome: "ok",
      cached: true,
    } as RunEvent);
    journal.appendEvent("dwfrun-cached", {
      type: "node-settled",
      instance: { siteId: "ask#3", ordinal: 1 },
      outcome: "ok",
    } as RunEvent);

    const row = rowOf("dwfrun-cached");
    const payloads = replayRunProgress(row, journal, CEILING);
    const settles = payloads.filter((payload) => payload.eventType === "node-settled");
    const own = mintActorSessionId("dwfrun-cached", actor);
    expect(settles.map((payload) => payload.actorSessionId)).toEqual([
      own,
      own,
      undefined,
      undefined,
    ]);
    expect(settles[0]).toMatchObject({
      payload: { kind: "ask", actor, actorSeq: 0, sourceSessionId: "sess-predecessor" },
    });
    expect("actorSessionId" in settles[2]!).toBe(false);
    expect("actorSessionId" in settles[3]!).toBe(false);

    const live = journal
      .listEvents("dwfrun-cached", { types: "all", reportItems: "all" })
      .map((entry) =>
        toProgressPayload({
          event: entry.event,
          runId: row.runId,
          sequence: entry.sequence,
          toolCallId: row.toolCallId!,
          concurrencyCeiling: CEILING,
        }),
      );
    expect(JSON.stringify(payloads)).toBe(JSON.stringify(live));

    const run = reduce("dwfrun-cached");
    expect(
      run.nodes.filter((node) => node.actorSiteId === "actor#1").map((node) => node.siteId),
    ).toEqual(["ask#1", "ask#2"]);
    expect(run.actors[0]?.sessionId).toBe(own);
  });

  it("行不是终态（本会话真在飞的 run 由调用方排除；这里是另一进程的）→ 事件原样回放，不追加结算", () => {
    createRun("dwfrun-live");
    const stored = journal.listEvents("dwfrun-live", { types: "all", reportItems: "all" });
    const payloads = replayRunProgress(rowOf("dwfrun-live"), journal, CEILING);
    expect(payloads).toHaveLength(stored.length);
    expect(payloads.some((payload) => payload.eventType === "run-settled")).toBe(false);
    expect(reduce("dwfrun-live").status).toBe("running");
  });
});
