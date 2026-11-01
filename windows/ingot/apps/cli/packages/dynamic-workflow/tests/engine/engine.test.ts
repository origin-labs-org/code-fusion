import { describe, expect, it } from "vitest";
import {
  InMemoryJournalStore,
  WorkflowEngine,
  WorkflowError,
  inputHash,
  refToString,
  type AskSpec,
  type Caps,
  type InstanceRef,
  type NodeKind,
  type NodeRecord,
  type PersonaSpec,
  type RunEvent,
  type StoredEvent,
  type ValidateFn,
} from "../../src/engine/index.js";
import { FakeDriver, flush } from "./fake-driver.js";
import { REPORT_CAPS } from "../../src/facade/report-caps.js";
import { validate } from "../../src/schema/validate.js";
import type { JsonSchema } from "../../src/schema/types.js";

const RUN = "run";

function inst(siteId: string, ordinal = 1): InstanceRef {
  return { siteId, ordinal };
}

const requireFields: ValidateFn = (schema, value) => {
  const required = (schema as { required?: string[] } | undefined)?.required ?? [];
  const obj = (value ?? {}) as Record<string, unknown>;
  return required
    .filter((k) => obj[k] === undefined)
    .map((k) => ({ path: k, expected: "present", got: "undefined" }));
};

interface SetupOpts {
  journal?: InMemoryJournalStore;
  caps?: Caps;
  askSpecs?: Map<string, AskSpec>;
  validate?: ValidateFn;
  deferSessions?: boolean;
  name?: string;
  scriptText?: string;
  scriptHash?: string;
  parentSessionId?: string;
  cwd?: string;
  toolCallId?: string;
  resumedFrom?: string;
  
  resolveModel?: (persona: { model?: string }) => string;
}

function setup(opts: SetupOpts = {}) {
  const journal = opts.journal ?? new InMemoryJournalStore();
  const driver = new FakeDriver(journal, {
    deferSessions: opts.deferSessions,
    ...(opts.resolveModel === undefined ? {} : { resolveModel: opts.resolveModel, runId: RUN }),
  });
  const engine = new WorkflowEngine({
    runId: RUN,
    driver,
    caps: opts.caps ?? { maxConcurrency: 16 },
    askSpecs: opts.askSpecs ?? untypedSpecs("ask#1", "ask#2"),
    validate: opts.validate ?? (() => []),
    ...(opts.name === undefined ? {} : { name: opts.name }),
    ...(opts.scriptText === undefined ? {} : { scriptText: opts.scriptText }),
    ...(opts.scriptHash === undefined ? {} : { scriptHash: opts.scriptHash }),
    ...(opts.parentSessionId === undefined ? {} : { parentSessionId: opts.parentSessionId }),
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    ...(opts.toolCallId === undefined ? {} : { toolCallId: opts.toolCallId }),
    ...(opts.resumedFrom === undefined ? {} : { resumedFrom: opts.resumedFrom }),
  });
  return { journal, driver, engine };
}

const untypedSpecs = (...siteIds: string[]): Map<string, AskSpec> =>
  new Map(siteIds.map((id) => [id, { typed: false } as AskSpec]));

const typedSpecs = () =>
  new Map<string, AskSpec>([["ask#1", { typed: true, schema: { required: ["x"] } }]]);

describe("WorkflowEngine — happy path", () => {
  it("dispatches, accepts a valid submit, and journals the node", async () => {
    const { engine, driver, journal } = setup({ askSpecs: typedSpecs(), validate: requireFields });
    const actor = engine.createActor("actor#1", "planner");
    const p = engine.ask("ask#1", actor, "do it");
    await flush();

    expect(driver.startAskCount()).toBe(1);
    expect(driver.startAsks[0]?.message.typed).toBe(true);
    expect(driver.startAsks[0]?.message.schema).toEqual({ required: ["x"] });

    engine.askStats(inst("ask#1"), { tokens: 10, toolCalls: 1, turns: 1 });
    engine.askSubmitAttempted(inst("ask#1"), { x: 1 });

    expect(driver.submitResponses.at(-1)?.verdict.kind).toBe("accept");
    await expect(p).resolves.toEqual({ x: 1 });

    const node = journal.getNode(RUN, "ask#1", 1);
    expect(node?.status).toBe("completed");
    expect(node?.actorSeq).toBe(0);
    expect(node?.inputHash).toBe(inputHash("do it"));
    expect(node?.result).toEqual({ x: 1 });
    expect(node?.stats).toEqual({ tokens: 10, toolCalls: 1, turns: 1 });
    expect(node?.actorSiteId).toBe("actor#1");

    engine.complete("final artifact");
    await expect(engine.settled).resolves.toEqual({
      status: "completed",
      artifact: "final artifact",
    });
    expect(engine.status()).toBe("completed");
  });
});

describe("WorkflowEngine — validation + repair", () => {
  it("rejects invalid submits and fails after the 3 repair attempts are exhausted", async () => {
    const { engine, driver, journal } = setup({ askSpecs: typedSpecs(), validate: requireFields });
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "do it");
    await flush();

    for (let i = 0; i < 4; i++) engine.askSubmitAttempted(inst("ask#1"), {});

    const rejects = driver.submitResponses.filter((r) => r.verdict.kind === "reject");
    expect(rejects).toHaveLength(3);
    expect(driver.cancels).toContainEqual(inst("ask#1"));

    await expect(p).rejects.toMatchObject({ code: "ValidationFailed" });
    const err = await p.catch((e: unknown) => e as { violations?: unknown[] });
    expect(err.violations?.length).toBeGreaterThan(0);

    const node = journal.getNode(RUN, "ask#1", 1);
    expect(node?.status).toBe("failed");
    expect(node?.error?.code).toBe("ValidationFailed");
  });

  it("repairs successfully within the attempt limit", async () => {
    const { engine, driver } = setup({ askSpecs: typedSpecs(), validate: requireFields });
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "do it");
    await flush();
    engine.askSubmitAttempted(inst("ask#1"), {}); // reject
    engine.askSubmitAttempted(inst("ask#1"), { x: 7 }); // accept
    await expect(p).resolves.toEqual({ x: 7 });
    expect(driver.submitResponses.map((r) => r.verdict.kind)).toEqual(["reject", "accept"]);
  });
});

describe("WorkflowEngine — nudge policy", () => {
  it("nudges once when the turn ends without a submit, then accepts", async () => {
    const { engine, driver } = setup({ askSpecs: typedSpecs(), validate: requireFields });
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "do it");
    await flush();
    engine.askTurnEnded(inst("ask#1"), "not yet");
    expect(driver.submitResponses.at(-1)?.verdict.kind).toBe("nudge");
    engine.askSubmitAttempted(inst("ask#1"), { x: 1 });
    await expect(p).resolves.toEqual({ x: 1 });
  });

  it("fails with ResultNotSubmitted + final text when nudge is exhausted", async () => {
    const { engine, driver } = setup({ askSpecs: typedSpecs(), validate: requireFields });
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "do it");
    await flush();
    engine.askTurnEnded(inst("ask#1"), "text one"); // nudge
    engine.askTurnEnded(inst("ask#1"), "final words"); // exhausted → fail
    await expect(p).rejects.toMatchObject({ code: "ResultNotSubmitted", finalText: "final words" });
    expect(driver.cancels).toContainEqual(inst("ask#1"));
  });
});

describe("WorkflowEngine — untyped ask", () => {
  it("settles on turn end with the final text and offers no submit tool", async () => {
    const { engine, driver, journal } = setup();
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "summarize");
    await flush();
    expect(driver.startAsks[0]?.message.typed).toBe(false);
    engine.askTurnEnded(inst("ask#1"), "the answer");
    await expect(p).resolves.toBe("the answer");
    expect(journal.getNode(RUN, "ask#1", 1)?.result).toBe("the answer");
  });
});

describe("WorkflowEngine — per-actor FIFO", () => {
  it("serializes concurrent asks on one actor and journals actorSeq in admission order", async () => {
    const { engine, driver, journal } = setup();
    const actor = engine.createActor("actor#1");
    const p1 = engine.ask("ask#1", actor, "A");
    const p2 = engine.ask("ask#2", actor, "B");
    await flush();

    expect(driver.startAskCount()).toBe(1);
    expect(driver.startAsks[0]?.instance).toEqual(inst("ask#1"));

    engine.askTurnEnded(inst("ask#1"), "ra");
    await flush();
    expect(driver.startAskCount()).toBe(2);
    expect(driver.startAsks[1]?.instance).toEqual(inst("ask#2"));

    engine.askTurnEnded(inst("ask#2"), "rb");
    await expect(Promise.all([p1, p2])).resolves.toEqual(["ra", "rb"]);

    expect(journal.getNode(RUN, "ask#1", 1)?.actorSeq).toBe(0);
    expect(journal.getNode(RUN, "ask#2", 1)?.actorSeq).toBe(1);
  });
});

describe("WorkflowEngine — replay", () => {
  it("short-circuits journaled nodes with zero startAsk calls", async () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    journal.putActor({ runId: RUN, siteId: "actor#1", ordinal: 1 });
    journal.putNode({
      runId: RUN,
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 0,
      inputHash: inputHash("do it"),
      status: "completed",
      result: { x: 42 },
    });

    const { engine, driver } = setup({ journal });
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "do it");
    await flush();

    expect(driver.startAskCount()).toBe(0);
    await expect(p).resolves.toEqual({ x: 42 });
  });

  it("fails the run loudly on an inputHash mismatch", async () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    journal.putActor({ runId: RUN, siteId: "actor#1", ordinal: 1 });
    journal.putNode({
      runId: RUN,
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 0,
      inputHash: "deadbeef",
      status: "completed",
      result: { x: 1 },
    });

    const { engine } = setup({ journal });
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "do it");
    await expect(p).rejects.toMatchObject({ code: "InputHashMismatch" });
    await expect(engine.settled).resolves.toMatchObject({
      status: "errored",
      error: { code: "InputHashMismatch" },
    });

    const err = await p.catch((e: unknown) => e as WorkflowError);
    expect(err.mismatch).toEqual({ expected: "deadbeef", got: inputHash("do it") });
    expect(err.toJSON()).toMatchObject({
      code: "InputHashMismatch",
      mismatch: { expected: "deadbeef", got: inputHash("do it") },
    });
    expect(journal.getRun(RUN)?.failure?.mismatch).toEqual({
      expected: "deadbeef",
      got: inputHash("do it"),
    });
  });

  it("enforces the recorded actorSeq via the hold rule when arrivals are scrambled", async () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    journal.putActor({ runId: RUN, siteId: "actor#1", ordinal: 1 });
    journal.putNode({
      runId: RUN,
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 0,
      inputHash: inputHash("A"),
      status: "completed",
      result: "r1",
    });
    journal.putNode({
      runId: RUN,
      siteId: "ask#2",
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 1,
      inputHash: inputHash("B"),
      status: "completed",
      result: "r2",
    });

    const { engine, driver } = setup({ journal });
    const actor = engine.createActor("actor#1");
    const pB = engine.ask("ask#2", actor, "B");
    const pA = engine.ask("ask#1", actor, "A");
    await expect(Promise.all([pA, pB])).resolves.toEqual(["r1", "r2"]);

    expect(driver.cachedSettleOrder()).toEqual(["ask#1@1", "ask#2@1"]);
    expect(driver.startAskCount()).toBe(0);
  });

  it("turns the same-site nondeterministic-ordinal gap into a loud inputHash failure (not wrong results)", async () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    journal.putActor({ runId: RUN, siteId: "actor#1", ordinal: 1 });
    journal.putNode({
      runId: RUN,
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 0,
      inputHash: inputHash("plan A"),
      status: "completed",
      result: "A",
    });
    journal.putNode({
      runId: RUN,
      siteId: "ask#1",
      ordinal: 2,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 1,
      inputHash: inputHash("plan B"),
      status: "completed",
      result: "B",
    });

    const { engine } = setup({ journal });
    const actor = engine.createActor("actor#1");
    const pB = engine.ask("ask#1", actor, "plan B");
    await expect(pB).rejects.toMatchObject({ code: "InputHashMismatch" });
    await expect(engine.settled).resolves.toMatchObject({
      status: "errored",
      error: { code: "InputHashMismatch" },
    });
  });
});

describe("WorkflowEngine — mid-run crash + resume", () => {
  it("resumes over the same journal, short-circuiting finished nodes and finishing the rest", async () => {
    const journal = new InMemoryJournalStore();

    {
      const driver1 = new FakeDriver(journal);
      const e1 = new WorkflowEngine({
        runId: RUN,
        driver: driver1,
        caps: { maxConcurrency: 16 },
        askSpecs: untypedSpecs("ask#1", "ask#2"),
        validate: () => [],
      });
      const a = e1.createActor("actor#1");
      const p1 = e1.ask("ask#1", a, "A");
      await flush();
      e1.askTurnEnded(inst("ask#1"), "RA");
      await expect(p1).resolves.toBe("RA");
    }

    const driver2 = new FakeDriver(journal);
    const e2 = new WorkflowEngine({
      runId: RUN,
      driver: driver2,
      caps: { maxConcurrency: 16 },
      askSpecs: untypedSpecs("ask#1", "ask#2"),
      validate: () => [],
    });
    const a2 = e2.createActor("actor#1");

    const r1 = await e2.ask("ask#1", a2, "A");
    expect(r1).toBe("RA");
    expect(driver2.startAskCount(inst("ask#1"))).toBe(0);

    const p2 = e2.ask("ask#2", a2, "B");
    await flush();
    expect(driver2.startAskCount(inst("ask#2"))).toBe(1);
    e2.askTurnEnded(inst("ask#2"), "RB");
    await expect(p2).resolves.toBe("RB");

    e2.complete("done");
    await expect(e2.settled).resolves.toMatchObject({ status: "completed", artifact: "done" });
  });

  it("re-dispatches a crash-mid-flight node (status running) live, enforcing its recorded actorSeq", async () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    journal.putActor({ runId: RUN, siteId: "actor#1", ordinal: 1 });
    journal.putNode({
      runId: RUN,
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 0,
      inputHash: inputHash("A"),
      status: "completed",
      result: "RA",
    });
    journal.putNode({
      runId: RUN,
      siteId: "ask#2",
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 1,
      inputHash: inputHash("B"),
      status: "running",
    });

    const { engine, journal: j, driver } = setup({ journal });
    const actor = engine.createActor("actor#1");
    const p1 = engine.ask("ask#1", actor, "A");
    const p2 = engine.ask("ask#2", actor, "B");
    await flush();

    expect(await p1).toBe("RA");
    expect(driver.startAskCount(inst("ask#1"))).toBe(0);
    expect(driver.startAskCount(inst("ask#2"))).toBe(1);

    engine.askTurnEnded(inst("ask#2"), "RB");
    expect(await p2).toBe("RB");
    expect(j.getNode(RUN, "ask#2", 1)?.status).toBe("completed");
    expect(j.getNode(RUN, "ask#2", 1)?.actorSeq).toBe(1);
  });

  it("re-creates the actor session via the driver even when the journal records a sessionId", async () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    journal.putActor({ runId: RUN, siteId: "actor#1", ordinal: 1, sessionId: "session:actor#1@1" });
    journal.putNode({
      runId: RUN,
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 0,
      inputHash: inputHash("A"),
      status: "running",
    });

    const { engine, journal: j, driver } = setup({ journal });
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "A");
    await flush();

    expect(driver.sessionCreations).toEqual([{ siteId: "actor#1", ordinal: 1 }]);
    expect(driver.startAskCount(inst("ask#1"))).toBe(1);
    expect(driver.startAsks[0]?.session.id).toBe("session:actor#1@1");

    engine.askTurnEnded(inst("ask#1"), "RA");
    await expect(p).resolves.toBe("RA");
    expect(j.getActor(RUN, "actor#1", 1)?.sessionId).toBe("session:actor#1@1");
  });

  it("restores the tokens already spent by the crashed run instead of starting from zero", async () => {
    const caps: Caps = { maxConcurrency: 16 };
    const journal = new InMemoryJournalStore();

    {
      const e1 = new WorkflowEngine({
        runId: RUN,
        driver: new FakeDriver(journal),
        caps,
        askSpecs: untypedSpecs("ask#1", "ask#2"),
        validate: () => [],
      });
      const a = e1.createActor("actor#1");
      const p = e1.ask("ask#1", a, "A");
      await flush();
      e1.askStats(inst("ask#1"), { tokens: 300, toolCalls: 1, turns: 1 });
      e1.askTurnEnded(inst("ask#1"), "RA");
      await expect(p).resolves.toBe("RA");
    }

    expect(journal.getRun(RUN)?.spentTokens).toBe(300);

    const driver2 = new FakeDriver(journal);
    const e2 = new WorkflowEngine({
      runId: RUN,
      driver: driver2,
      caps,
      askSpecs: untypedSpecs("ask#1", "ask#2"),
      validate: () => [],
    });
    const b = e2.createActor("actor#2");
    void e2.ask("ask#2", b, "B").catch(() => {});
    await flush();
    e2.askStats(inst("ask#2"), { tokens: 100, toolCalls: 0, turns: 1 });
    expect(driver2.events.at(-1)).toEqual({ type: "usage-updated", spentTokens: 400 });
    expect(journal.getRun(RUN)?.spentTokens).toBe(400);
  });
});

describe("WorkflowEngine — cancellation", () => {
  it("cancels in-flight asks, settles cancelled, and keeps finished journal entries", async () => {
    const { engine, driver, journal } = setup();
    const actor = engine.createActor("actor#1");

    const pDone = engine.ask("ask#1", actor, "A");
    await flush();
    engine.askTurnEnded(inst("ask#1"), "RA");
    await expect(pDone).resolves.toBe("RA");

    const pInFlight = engine.ask("ask#2", actor, "B");
    await flush();
    expect(driver.startAskCount(inst("ask#2"))).toBe(1);

    engine.stop("user");
    expect(driver.cancels).toContainEqual(inst("ask#2"));
    await expect(pInFlight).rejects.toMatchObject({ code: "Cancelled" });
    await expect(engine.settled).resolves.toEqual({ status: "stopped", reason: "user" });
    expect(journal.getRun(RUN)).toMatchObject({ status: "stopped", stopReason: "user" });
    expect(driver.events.at(-1)).toEqual({
      type: "run-settled",
      status: "stopped",
      stopReason: "user",
    });

    expect(journal.getNode(RUN, "ask#1", 1)?.status).toBe("completed");
    expect(journal.getNode(RUN, "ask#2", 1)?.status).toBe("running");
  });
});

describe("WorkflowEngine — complete() with in-flight asks", () => {
  it("aborts the in-flight ask like stop() does, then settles completed with the artifact", async () => {
    const { engine, driver, journal } = setup();
    const actor = engine.createActor("actor#1");

    const pDone = engine.ask("ask#1", actor, "A");
    await flush();
    engine.askTurnEnded(inst("ask#1"), "RA");
    await expect(pDone).resolves.toBe("RA");

    const pInFlight = engine.ask("ask#2", actor, "B");
    await flush();
    expect(driver.startAskCount(inst("ask#2"))).toBe(1);

    engine.complete("done");
    expect(driver.cancels).toContainEqual(inst("ask#2"));
    await expect(pInFlight).rejects.toMatchObject({ code: "Cancelled" });
    await expect(engine.settled).resolves.toEqual({ status: "completed", artifact: "done" });
    expect(engine.status()).toBe("completed");

    const types = driver.events.map((e) => e.type);
    const settledIdx = types.lastIndexOf("node-settled");
    const runIdx = types.lastIndexOf("run-settled");
    expect(driver.events[settledIdx]).toMatchObject({
      instance: inst("ask#2"),
      outcome: "cancelled",
    });
    expect(driver.events[runIdx]).toMatchObject({ status: "completed" });
    expect(settledIdx).toBeLessThan(runIdx);

    expect(journal.getNode(RUN, "ask#1", 1)?.status).toBe("completed");
    expect(journal.getNode(RUN, "ask#2", 1)?.status).toBe("running");
    expect(journal.getRun(RUN)?.status).toBe("completed");
    expect(journal.getRun(RUN)?.result).toBe("done");
  });

  it("does nothing extra when no ask is in flight (byte-for-byte the plain complete)", async () => {
    const { engine, driver } = setup();
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "A");
    await flush();
    engine.askTurnEnded(inst("ask#1"), "RA");
    await expect(p).resolves.toBe("RA");

    engine.complete("done");
    expect(driver.cancels).toEqual([]);
    expect(driver.eventsOfType("node-settled").map((e) => e.outcome)).toEqual(["ok"]);
    await expect(engine.settled).resolves.toEqual({ status: "completed", artifact: "done" });
  });

  it("persists straggler stats after complete() to the usage row without emitting events", async () => {
    const { engine, driver, journal } = setup();
    const winner = engine.createActor("actor#1");
    const loser = engine.createActor("actor#2");
    const pWin = engine.ask("ask#1", winner, "fast");
    void engine.ask("ask#2", loser, "slow").catch(() => {});
    await flush();
    engine.askTurnEnded(inst("ask#1"), "won");
    await expect(pWin).resolves.toBe("won");
    engine.complete("won");

    const eventCount = driver.events.length;
    engine.askStats(inst("ask#2"), { tokens: 7, toolCalls: 0, turns: 1 });
    expect(driver.events.length).toBe(eventCount);
    expect(journal.getRun(RUN)?.spentTokens).toBe(7);
    expect(journal.getNode(RUN, "ask#2", 1)?.stats).toEqual({ tokens: 7, toolCalls: 0, turns: 1 });
  });
});

describe("WorkflowEngine — driver dispose at settlement", () => {
  async function withInFlightAsk() {
    const { engine, driver } = setup();
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "A");
    void p.catch(() => {});
    await flush();
    expect(driver.disposeCalls).toBe(0);
    return { engine, driver };
  }

  function expectDisposedOnceAfterRunSettled(driver: FakeDriver): void {
    expect(driver.disposeCalls).toBe(1);
    const runSettledIdx = driver.events.findIndex((e) => e.type === "run-settled");
    expect(runSettledIdx).toBeGreaterThanOrEqual(0);
    expect(driver.eventsAtDispose).toBe(runSettledIdx + 1);
  }

  it("complete(): once, after run-settled, and not again on a later stop()/fail()", async () => {
    const { engine, driver } = await withInFlightAsk();
    engine.complete("done");
    expectDisposedOnceAfterRunSettled(driver);
    engine.stop("user");
    engine.fail(new WorkflowError("DriverError", "late"));
    expect(driver.disposeCalls).toBe(1);
  });

  it("stop(): once, after run-settled", async () => {
    const { engine, driver } = await withInFlightAsk();
    engine.stop("user");
    expectDisposedOnceAfterRunSettled(driver);
    engine.complete("late");
    expect(driver.disposeCalls).toBe(1);
  });

  it("fail(): once, after run-settled", async () => {
    const { engine, driver } = await withInFlightAsk();
    engine.fail(new WorkflowError("DriverError", "boom"));
    expectDisposedOnceAfterRunSettled(driver);
    expect(driver.disposeCalls).toBe(1);
  });

  it("a driver without dispose is fine (the hook is optional)", async () => {
    const journal = new InMemoryJournalStore();
    const driver = new FakeDriver(journal);
    (driver as { dispose?: () => void }).dispose = undefined;
    const engine = new WorkflowEngine({
      runId: RUN,
      driver,
      caps: { maxConcurrency: 16 },
      askSpecs: untypedSpecs("ask#1"),
      validate: () => [],
    });
    engine.complete("done");
    await expect(engine.settled).resolves.toEqual({ status: "completed", artifact: "done" });
  });
});

describe("WorkflowEngine — usage (no caps)", () => {
  it("never caps the node count: well past the old limit of 100 the run is still running", async () => {
    const { engine, driver, journal } = setup({ caps: { maxConcurrency: 200 } });
    for (let i = 1; i <= 120; i++) {
      const actor = engine.createActor(`actor#${i}`);
      void engine.ask("ask#1", actor, `job ${i}`).catch(() => {});
    }
    await flush();

    expect(journal.getRun(RUN)?.status).toBe("running");
    expect(driver.events.filter((e) => e.type === "node-dispatched")).toHaveLength(120);
    engine.stop("user");
  });

  it("emits usage-updated with the accumulated spentTokens and never fails the run on usage", async () => {
    const { engine, driver, journal } = setup({ askSpecs: typedSpecs(), validate: requireFields });
    const actor = engine.createActor("actor#1");
    void engine.ask("ask#1", actor, "do it").catch(() => {});
    await flush();

    engine.askStats(inst("ask#1"), { tokens: 30, toolCalls: 0, turns: 1 });
    expect(driver.events.at(-1)).toEqual({ type: "usage-updated", spentTokens: 30 });
    expect(journal.getRun(RUN)?.spentTokens).toBe(30);

    engine.askStats(inst("ask#1"), { tokens: 80, toolCalls: 0, turns: 1 });
    expect(driver.events.at(-1)).toEqual({ type: "usage-updated", spentTokens: 110 });
    expect(journal.getRun(RUN)?.spentTokens).toBe(110);
    expect(journal.getRun(RUN)?.status).toBe("running");
    engine.stop("user");
  });
});

describe("WorkflowEngine — fail() (harness-driven run failure)", () => {
  it("settles failed, cancels in-flight asks, records failure_json, and is first-wins", async () => {
    const { engine, driver, journal } = setup();
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "A");
    void p.catch(() => {});
    await flush();
    expect(driver.startAskCount(inst("ask#1"))).toBe(1);

    const boom = new WorkflowError("DriverError", "child crashed");
    engine.fail(boom);

    expect(driver.cancels).toContainEqual(inst("ask#1"));
    await expect(p).rejects.toBe(boom);
    await expect(engine.settled).resolves.toEqual({ status: "errored", error: boom });
    expect(engine.status()).toBe("errored");

    const run = journal.getRun(RUN);
    expect(run?.status).toBe("errored");
    expect(run?.failure).toEqual({ code: "DriverError", message: "child crashed" });
    expect(run?.stopReason).toBeUndefined();

    engine.complete("late");
    engine.fail(new WorkflowError("Cancelled", "ignored"));
    engine.stop("interrupted", new WorkflowError("Interrupted", "late"));
    await expect(engine.settled).resolves.toEqual({ status: "errored", error: boom });
  });

  it("createActorSession rejection surfaces the cause text in the DriverError (journal + reject)", async () => {
    const { engine, journal, driver } = setup({ deferSessions: true });
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "A");
    driver.sessionDeferrals[0]!.reject(new Error("FOREIGN KEY constraint failed"));
    await expect(p).rejects.toMatchObject({
      code: "DriverError",
      message: expect.stringContaining("FOREIGN KEY constraint failed"),
    });
    expect(journal.getNode(RUN, "ask#1", 1)?.error).toMatchObject({
      code: "DriverError",
      message: expect.stringContaining("FOREIGN KEY constraint failed"),
    });
  });

  it("complete() first wins over a later fail()", async () => {
    const { engine } = setup();
    engine.complete("ok");
    engine.fail(new WorkflowError("DriverError", "too late"));
    await expect(engine.settled).resolves.toEqual({ status: "completed", artifact: "ok" });
  });

  it("createActor throws synchronously once the run has failed (harness can catch → fail())", async () => {
    const { engine } = setup();
    engine.fail(new WorkflowError("DriverError", "boom"));
    expect(() => engine.createActor("actor#1")).toThrow();
  });
});

describe("WorkflowEngine — stats backfill after settle", () => {
  it("backfills stats onto a typed ask journaled at settle when askStats arrives after the submit", async () => {
    const { engine, journal } = setup({ askSpecs: typedSpecs(), validate: requireFields });
    const actor = engine.createActor("actor#1", "planner");
    const p = engine.ask("ask#1", actor, "do it");
    await flush();

    engine.askSubmitAttempted(inst("ask#1"), { x: 1 });
    await expect(p).resolves.toEqual({ x: 1 });

    const settled = journal.getNode(RUN, "ask#1", 1);
    expect(settled?.status).toBe("completed");
    expect(settled?.stats).toBeUndefined();

    engine.askStats(inst("ask#1"), { tokens: 42, toolCalls: 2, turns: 1 });

    const node = journal.getNode(RUN, "ask#1", 1);
    expect(node?.stats).toEqual({ tokens: 42, toolCalls: 2, turns: 1 });
    expect(node?.status).toBe("completed");
    expect(node?.result).toEqual({ x: 1 });
    expect(node?.actorSeq).toBe(0);
    expect(node?.inputHash).toBe(inputHash("do it"));
    expect(node?.actorSiteId).toBe("actor#1");
    expect(node?.actorOrdinal).toBe(1);
    expect(node?.kind).toBe("ask");
  });

  it("is a no-op when the node was never journaled (defensive, best-effort)", async () => {
    const { engine, journal } = setup({ askSpecs: typedSpecs(), validate: requireFields });
    engine.createActor("actor#1");
    engine.askStats(inst("ask#404"), { tokens: 5, toolCalls: 0, turns: 1 });
    expect(journal.getNode(RUN, "ask#404", 1)).toBeUndefined();
  });
});

describe("WorkflowEngine — run metadata", () => {
  it("persists supplied run metadata through createRun", async () => {
    const { journal } = setup({
      scriptText: 'await agent("a").ask("hi");',
      scriptHash: "hash-a",
      parentSessionId: "sess_parent",
      cwd: "/tmp/project",
      toolCallId: "call-abc",
      name: "nightly triage",
      resumedFrom: "run-predecessor",
    });
    expect(journal.getRun(RUN)).toMatchObject({
      runId: RUN,
      status: "running",
      scriptText: 'await agent("a").ask("hi");',
      scriptHash: "hash-a",
      parentSessionId: "sess_parent",
      cwd: "/tmp/project",
      toolCallId: "call-abc",
      name: "nightly triage",
      resumedFrom: "run-predecessor",
    });
  });

  it("omits the metadata fields entirely when the config carries none", async () => {
    const { journal } = setup();
    const run = journal.getRun(RUN)!;
    expect("scriptText" in run).toBe(false);
    expect("scriptHash" in run).toBe(false);
    expect("parentSessionId" in run).toBe(false);
    expect("cwd" in run).toBe(false);
    expect("name" in run).toBe(false);
    expect("toolCallId" in run).toBe(false);
    // （docs/execution-engine.md）。
    expect("resumedFrom" in run).toBe(false);
  });
});

// （docs/execution-engine.md「Amend-resume」）。
describe("WorkflowEngine — actor name uniqueness", () => {
  it("fails the run when a non-empty name repeats (both sites via the name argument)", async () => {
    const { engine, journal } = setup();
    engine.createActor("actor#1", "planner");
    expect(() => engine.createActor("actor#2", "planner")).toThrow(
      expect.objectContaining({ code: "DuplicateActorName" }),
    );
    await expect(engine.settled).resolves.toMatchObject({
      status: "errored",
      error: expect.objectContaining({ code: "DuplicateActorName" }),
    });
    expect(journal.getRun(RUN)?.failure?.code).toBe("DuplicateActorName");
  });

  it("compares the effective name, so persona.name collides with a plain name argument", async () => {
    const { engine } = setup();
    engine.createActor("actor#1", "reviewer");
    expect(() => engine.createActor("actor#2", "second", { name: "reviewer" })).toThrow(
      expect.objectContaining({ code: "DuplicateActorName" }),
    );
  });

  it("does not collide when persona.name renames one of two identical name arguments", async () => {
    const { engine, journal } = setup();
    engine.createActor("actor#1", "worker");
    engine.createActor("actor#2", "worker", { name: "worker-2" });
    expect(journal.getRun(RUN)?.status).toBe("running");
    expect(
      journal
        .listActors(RUN, { withPersona: true })
        .map((a) => a.persona?.name)
        .sort(),
    ).toEqual(["worker", "worker-2"]);
  });

  it("allows any number of anonymous actors (absent or empty names)", async () => {
    const { engine, journal } = setup();
    engine.createActor("actor#1");
    engine.createActor("actor#2");
    engine.createActor("actor#3", "");
    engine.createActor("actor#4", "", { name: "" });
    expect(journal.getRun(RUN)?.status).toBe("running");
    expect(journal.listActors(RUN, { withPersona: true })).toHaveLength(4);
  });

  it("allows distinct names", async () => {
    const { engine, journal } = setup();
    engine.createActor("actor#1", "planner");
    engine.createActor("actor#2", "reviewer");
    expect(journal.getRun(RUN)?.status).toBe("running");
  });

  it("does not false-positive on a byte-identical resume (fresh engine, names re-registered once)", async () => {
    const journal = new InMemoryJournalStore();
    {
      const e1 = setup({ journal }).engine;
      e1.createActor("actor#1", "planner");
      e1.createActor("actor#2", "reviewer");
      e1.stop("user");
    }
    const { engine, journal: same } = setup({ journal });
    expect(() => {
      engine.createActor("actor#1", "planner");
      engine.createActor("actor#2", "reviewer");
    }).not.toThrow();
    expect(same.getRun(RUN)?.status).toBe("running");
  });
});

describe("WorkflowEngine — actor persona and resolved model", () => {
  it("carries the persona through to the driver, the actor-created event and the journal", async () => {
    const { engine, driver, journal } = setup();
    const actor = engine.createActor("actor#1", "judge", {
      system: "You judge.",
    });
    const p = engine.ask("ask#1", actor, "judge it");
    await flush();

    expect(driver.sessionPersonas[0]).toEqual({
      name: "judge",
      system: "You judge.",
    });
    const created = driver.events.find((e) => e.type === "actor-created");
    expect(created).toMatchObject({
      persona: { name: "judge", system: "You judge." },
    });
    expect(journal.getActor(RUN, "actor#1", 1)?.persona).toEqual({
      name: "judge",
      system: "You judge.",
    });

    engine.askTurnEnded(inst("ask#1"), "ok");
    await expect(p).resolves.toBe("ok");
  });

  it("carries a persona model name verbatim to the driver, the event and the journal", async () => {
    const { engine, driver, journal } = setup();
    const actor = engine.createActor("actor#1", "judge", {
      system: "You judge.",
      model: "GLM-5.3-Flash$high",
    });
    const p = engine.ask("ask#1", actor, "judge it");
    await flush();

    const expected = { name: "judge", system: "You judge.", model: "GLM-5.3-Flash$high" };
    expect(driver.sessionPersonas[0]).toEqual(expected);
    expect(driver.events.find((e) => e.type === "actor-created")).toMatchObject({
      persona: expected,
    });
    expect(journal.getActor(RUN, "actor#1", 1)?.persona).toEqual(expected);
    expect(driver.events.find((e) => e.type === "node-dispatched")).toMatchObject({
      actorName: "judge",
      actorPersonaModel: "GLM-5.3-Flash$high",
    });

    engine.askTurnEnded(inst("ask#1"), "ok");
    await expect(p).resolves.toBe("ok");
  });

  it("a dispatch of a persona without a model carries no actorPersonaModel", async () => {
    const { engine, driver } = setup();
    const actor = engine.createActor("actor#1", "judge", { system: "You judge." });
    const p = engine.ask("ask#1", actor, "judge it");
    await flush();
    const dispatched = driver.events.find((e) => e.type === "node-dispatched");
    expect(dispatched).toBeDefined();
    expect("actorPersonaModel" in dispatched!).toBe(false);
    engine.askTurnEnded(inst("ask#1"), "ok");
    await expect(p).resolves.toBe("ok");
  });

  it("keeps only the known string fields of an object persona off the wire", async () => {
    const { engine, journal } = setup();
    engine.createActor("actor#1", "judge", {
      system: "You judge.",
      model: 42,
      tools: "none",
    } as unknown as PersonaSpec);
    expect(journal.getActor(RUN, "actor#1", 1)?.persona).toEqual({
      name: "judge",
      system: "You judge.",
    });
  });

  it("carries a string persona through unchanged (nothing invented)", async () => {
    const { engine, journal } = setup();
    engine.createActor("actor#1", "planner", "You plan.");
    const persona = journal.getActor(RUN, "actor#1", 1)?.persona;
    expect(persona).toEqual({ name: "planner", system: "You plan." });
  });

  it("does not clobber the driver-written resolvedModel when journaling the session", async () => {
    const { engine, journal } = setup({
      resolveModel: (persona) =>
        persona.name === "judge" ? "anthropic/haiku" : "anthropic/sonnet",
    });
    const actor = engine.createActor("actor#1", "judge", { system: "You judge." });
    const p = engine.ask("ask#1", actor, "judge it");
    await flush();

    const record = journal.getActor(RUN, "actor#1", 1);
    expect(record?.resolvedModel).toBe("anthropic/haiku");
    expect(record?.sessionId).toBe("session:actor#1@1");
    expect(record?.persona).toEqual({ name: "judge", system: "You judge." });

    engine.askTurnEnded(inst("ask#1"), "ok");
    await expect(p).resolves.toBe("ok");
  });

  it("preserves a journaled resolvedModel across a replayed createActor", async () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    journal.putActor({
      runId: RUN,
      siteId: "actor#1",
      ordinal: 1,
      sessionId: "session:actor#1@1",
      resolvedModel: "anthropic/haiku",
    });

    const { engine } = setup({ journal });
    engine.createActor("actor#1", "judge", { system: "You judge." });

    expect(journal.getActor(RUN, "actor#1", 1)).toMatchObject({
      sessionId: "session:actor#1@1",
      resolvedModel: "anthropic/haiku",
      persona: { name: "judge", system: "You judge." },
    });
  });
});

describe("WorkflowEngine — resume script identity", () => {
  
  function seedRun(journal: InMemoryJournalStore, scriptHash?: string): void {
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 7,
      status: "stopped",
      stopReason: "user",
      ...(scriptHash === undefined ? {} : { scriptHash }),
    });
  }

  it("refuses to resume when the journaled scriptHash differs from the config's", () => {
    const journal = new InMemoryJournalStore();
    seedRun(journal, "hash-old");
    const driver = new FakeDriver(journal);

    const construct = () =>
      new WorkflowEngine({
        runId: RUN,
        driver,
        caps: { maxConcurrency: 16 },
        askSpecs: new Map(),
        validate: () => [],
        scriptHash: "hash-new",
      });
    expect(construct).toThrowError(expect.objectContaining({ code: "ScriptHashMismatch" }));

    let thrown: WorkflowError | undefined;
    try {
      construct();
    } catch (error) {
      thrown = error as WorkflowError;
    }
    expect(thrown?.mismatch).toEqual({ expected: "hash-old", got: "hash-new" });
    expect(thrown?.toJSON()).toMatchObject({
      code: "ScriptHashMismatch",
      mismatch: { expected: "hash-old", got: "hash-new" },
    });
    expect(WorkflowError.fromJSON(thrown!.toJSON()).mismatch).toEqual({
      expected: "hash-old",
      got: "hash-new",
    });

    expect(journal.getRun(RUN)).toMatchObject({
      status: "stopped",
      scriptHash: "hash-old",
      spentTokens: 7,
    });
    expect(driver.events).toEqual([]);
    expect(journal.listEvents(RUN, { types: "all", reportItems: "all" })).toEqual([]);
  });

  it("resumes when the two hashes match", () => {
    const journal = new InMemoryJournalStore();
    seedRun(journal, "hash-same");
    const driver = new FakeDriver(journal);
    const engine = new WorkflowEngine({
      runId: RUN,
      driver,
      caps: { maxConcurrency: 16 },
      askSpecs: new Map(),
      validate: () => [],
      scriptHash: "hash-same",
    });
    expect(engine.status()).toBe("running");
    expect(journal.getRun(RUN)?.spentTokens).toBe(7);
  });

  it("resumes when either side has no hash (records predating run metadata)", () => {
    const withoutRecordHash = new InMemoryJournalStore();
    seedRun(withoutRecordHash);
    expect(
      new WorkflowEngine({
        runId: RUN,
        driver: new FakeDriver(withoutRecordHash),
        caps: { maxConcurrency: 16 },
        askSpecs: new Map(),
        validate: () => [],
        scriptHash: "hash-new",
      }).status(),
    ).toBe("running");

    const withoutConfigHash = new InMemoryJournalStore();
    seedRun(withoutConfigHash, "hash-old");
    expect(
      new WorkflowEngine({
        runId: RUN,
        driver: new FakeDriver(withoutConfigHash),
        caps: { maxConcurrency: 16 },
        askSpecs: new Map(),
        validate: () => [],
      }).status(),
    ).toBe("running");
  });
});

describe("WorkflowEngine — askSpecs completeness", () => {
  it("fails the run loudly instead of degrading an unlisted ask site to untyped", async () => {
    const { engine, driver } = setup({ askSpecs: typedSpecs(), validate: requireFields });
    const actor = engine.createActor("actor#1");

    const p = engine.ask("ask#2", actor, "unlisted site");
    await expect(p).rejects.toMatchObject({ code: "MissingAskSpec" });
    await flush();

    expect(driver.startAsks).toEqual([]);
    await expect(engine.settled).resolves.toMatchObject({
      status: "errored",
      error: { code: "MissingAskSpec" },
    });
  });
});

describe("WorkflowEngine — world reads", () => {
  it("journals a world.run dispatch under kind world-run (effects are not reads)", async () => {
    const { engine, driver, journal } = setup();
    const p = engine.worldRead("world-read#1", "run", ["lean", ["a.lean"], { timeoutMs: 60000 }]);
    expect(driver.worldReads[0]?.op).toBe("run");
    driver.worldReads[0]?.deferred.resolve({ exitCode: 1, stdout: "", stderr: "boom" });
    await expect(p).resolves.toEqual({ exitCode: 1, stdout: "", stderr: "boom" });

    const node = journal.getNode(RUN, "world-read#1", 1);
    expect(node?.kind).toBe("world-run");
    expect(node?.inputHash).toBe(
      inputHash({ op: "run", args: ["lean", ["a.lean"], { timeoutMs: 60000 }] }),
    );
    const queued = driver.events.find(
      (event) => event.type === "node-queued" && event.instance.siteId === "world-read#1",
    );
    expect(queued !== undefined && queued.type === "node-queued" ? queued.kind : undefined).toBe(
      "world-run",
    );
  });

  it("dispatches a live world read, journals it, and resolves", async () => {
    const { engine, driver, journal } = setup();
    const p = engine.worldRead("world-read#1", "glob", ["src/**"]);
    expect(driver.worldReads[0]?.op).toBe("glob");
    driver.worldReads[0]?.deferred.resolve({ exitCode: 0, stdout: "src/a.ts\n", stderr: "" });
    await expect(p).resolves.toEqual({ exitCode: 0, stdout: "src/a.ts\n", stderr: "" });

    const node = journal.getNode(RUN, "world-read#1", 1);
    expect(node?.kind).toBe("world-read");
  });
});

class CapturingJournal extends InMemoryJournalStore {
  readonly appended: RunEvent[] = [];

  override appendEvent(runId: string, event: RunEvent): StoredEvent {
    this.appended.push(event);
    return super.appendEvent(runId, event);
  }
}

describe("WorkflowEngine — 出生阶段坐标（phaseName）", () => {
  it("stamps the actor and the nodes minted after a phase marker", async () => {
    const { engine, driver } = setup();
    engine.enterPhase("规划");
    const actor = engine.createActor("actor#1", "planner");
    void engine.ask("ask#1", actor, "do it");
    void engine.worldRead("world-read#1", "glob", ["src/**"]);
    await flush();

    const queued = driver.eventsOfType("node-queued")[0]!;
    const dispatched = driver.eventsOfType("node-dispatched")[0]!;
    expect(queued.phaseName).toBe("规划");
    expect(dispatched.phaseName).toBe("规划");
  });
});

describe("WorkflowEngine — node-dispatched 重复出生事实", () => {
  it("repeats exactly what the instance's node-queued and its actor-created carried", async () => {
    const { engine, driver } = setup();
    engine.enterPhase("规划");
    const actor = engine.createActor("actor#1", "planner");
    const p = engine.ask("ask#1", actor, "  写一份调研大纲  ");
    await flush();

    const created = driver.eventsOfType("actor-created")[0]!;
    const queued = driver.eventsOfType("node-queued")[0]!;
    const dispatched = driver.eventsOfType("node-dispatched")[0]!;
    expect(dispatched).toEqual({
      type: "node-dispatched",
      instance: queued.instance,
      kind: queued.kind,
      actor: queued.actor,
      actorName: created.name,
      actorPhaseName: created.phaseName,
      phaseName: queued.phaseName,
      instructionsHead: queued.instructionsHead,
    });
    expect(dispatched.instructionsHead).toBe("写一份调研大纲");
    expect(dispatched.actorName).toBe("planner");

    engine.askTurnEnded(inst("ask#1"), "RA");
    await expect(p).resolves.toBe("RA");
  });

  it("omits the name of an anonymous subagent and keeps a world read's dispatch bare", async () => {
    const { engine, driver } = setup();
    const actor = engine.createActor("actor#1");
    const p = engine.ask("ask#1", actor, "do it");
    void engine.worldRead("world-read#1", "glob", ["src/**"]);
    await flush();

    expect(driver.eventsOfType("actor-created")[0]!.name).toBeUndefined();
    const [world, ask] = driver.eventsOfType("node-dispatched");
    expect(ask).toEqual({
      type: "node-dispatched",
      instance: inst("ask#1"),
      kind: "ask",
      actor: { siteId: "actor#1", ordinal: 1 },
      instructionsHead: "do it",
    });
    expect(world).toEqual({ type: "node-dispatched", instance: inst("world-read#1") });

    engine.askTurnEnded(inst("ask#1"), "RA");
    await expect(p).resolves.toBe("RA");
  });

  it("carries the facts of the new life when a running row is re-queued on resume", async () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    journal.putActor({ runId: RUN, siteId: "actor#1", ordinal: 1 });
    journal.putNode({
      runId: RUN,
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 0,
      inputHash: inputHash("do it"),
      status: "running",
    });

    const { engine, driver } = setup({ journal });
    engine.enterPhase("重跑");
    const actor = engine.createActor("actor#1", "planner");
    const p = engine.ask("ask#1", actor, "do it");
    await flush();

    const queued = driver.eventsOfType("node-queued")[0]!;
    const dispatched = driver.eventsOfType("node-dispatched")[0]!;
    expect(queued.phaseName).toBe("重跑");
    expect(dispatched).toMatchObject({
      kind: queued.kind,
      actor: queued.actor,
      actorName: "planner",
      actorPhaseName: "重跑",
      phaseName: "重跑",
      instructionsHead: queued.instructionsHead,
    });

    engine.askTurnEnded(inst("ask#1"), "RA");
    await expect(p).resolves.toBe("RA");
  });
});

describe("run-launched: anchor for the turn initiating the run (docs/execution-engine.md \'Token telemetry for subagents\')", () => {
  const make = (journal: InMemoryJournalStore) =>
    new WorkflowEngine({
      runId: RUN,
      driver: new FakeDriver(journal),
      caps: { maxConcurrency: 16 },
      askSpecs: untypedSpecs("ask#1"),
      validate: () => [],
      toolCallId: "tool-1",
      parentSessionId: "parent-1",
      launch: { inputId: "launch-input-1" },
    });

  it("建 run 那一世紧跟首条 run-started 记一条 run-launched，携 inputId / toolCallId / parentSessionId", () => {
    const journal = new InMemoryJournalStore();
    make(journal);
    expect(
      journal
        .listEvents(RUN, { types: "all", reportItems: "all" })
        .map((stored) => stored.event.type),
    ).toEqual(["run-started", "run-launched"]);
    expect(journal.listEvents(RUN, { types: "all", reportItems: "all" })[1]?.event).toEqual({
      type: "run-launched",
      inputId: "launch-input-1",
      toolCallId: "tool-1",
      parentSessionId: "parent-1",
    });
  });

  it("同一 journal 上重放（resume）只再发 run-started，不再发第二条 run-launched", () => {
    const journal = new InMemoryJournalStore();
    make(journal);
    make(journal);
    expect(
      journal
        .listEvents(RUN, { types: "all", reportItems: "all" })
        .map((stored) => stored.event.type),
    ).toEqual(["run-started", "run-launched", "run-started"]);
  });

  it("没有 launch 入参就不记锚点（CLI / 旧宿主装配）", () => {
    const journal = new InMemoryJournalStore();
    new WorkflowEngine({
      runId: RUN,
      driver: new FakeDriver(journal),
      caps: { maxConcurrency: 16 },
      askSpecs: untypedSpecs("ask#1"),
      validate: () => [],
    });
    expect(
      journal
        .listEvents(RUN, { types: "all", reportItems: "all" })
        .map((stored) => stored.event.type),
    ).toEqual(["run-started"]);
  });

  it("launch 携 phaseNames 时 run-launched 原样带上声明的阶段表（侧栏迷你轨道的站点来源）", () => {
    const journal = new InMemoryJournalStore();
    new WorkflowEngine({
      runId: RUN,
      driver: new FakeDriver(journal),
      caps: { maxConcurrency: 16 },
      askSpecs: untypedSpecs("ask#1"),
      validate: () => [],
      launch: { inputId: "launch-input-2", phaseNames: ["Research", "Write"] },
    });
    expect(journal.listEvents(RUN, { types: "all", reportItems: "all" })[1]?.event).toEqual({
      type: "run-launched",
      inputId: "launch-input-2",
      phaseNames: ["Research", "Write"],
    });
  });

  it("launch 携 subagentModel 时 run-launched 原样带上规范串（档位段在内），resume 不再记第二条", () => {
    const journal = new InMemoryJournalStore();
    const withModel = () =>
      new WorkflowEngine({
        runId: RUN,
        driver: new FakeDriver(journal),
        caps: { maxConcurrency: 16 },
        askSpecs: untypedSpecs("ask#1"),
        validate: () => [],
        launch: { inputId: "launch-input-3", subagentModel: "zhipu/glm-5.3-flash$high" },
      });
    withModel();
    expect(journal.listEvents(RUN, { types: "all", reportItems: "all" })[1]?.event).toEqual({
      type: "run-launched",
      inputId: "launch-input-3",
      subagentModel: "zhipu/glm-5.3-flash$high",
    });

    withModel();
    expect(
      journal
        .listEvents(RUN, { types: "all", reportItems: "all" })
        .filter((stored) => stored.event.type === "run-launched"),
    ).toHaveLength(1);
  });

  it("launch 携 modelBindings 时 run-launched 原样带上整张表，resume 不再记第二条", () => {
    const journal = new InMemoryJournalStore();
    const bindings = {
      "GLM-5.3-Flash": "zhipu/GLM-5.3-Flash$high",
      "GLM-5.3$high": "zhipu/GLM-5.3$high",
    };
    const withBindings = () =>
      new WorkflowEngine({
        runId: RUN,
        driver: new FakeDriver(journal),
        caps: { maxConcurrency: 16 },
        askSpecs: untypedSpecs("ask#1"),
        validate: () => [],
        launch: { inputId: "launch-input-4", modelBindings: bindings },
      });
    withBindings();
    expect(journal.listEvents(RUN, { types: "all", reportItems: "all" })[1]?.event).toEqual({
      type: "run-launched",
      inputId: "launch-input-4",
      modelBindings: bindings,
    });
    withBindings();
    expect(
      journal
        .listEvents(RUN, { types: "all", reportItems: "all" })
        .filter((stored) => stored.event.type === "run-launched"),
    ).toHaveLength(1);
  });

  it("launch 不带 modelBindings 时整个键缺席", () => {
    const journal = new InMemoryJournalStore();
    make(journal);
    expect(
      "modelBindings" in journal.listEvents(RUN, { types: "all", reportItems: "all" })[1]!.event,
    ).toBe(false);
  });

  it("launch 不带 subagentModel 时整个键缺席（缺席即子代理跑在会话模型上）", () => {
    const journal = new InMemoryJournalStore();
    make(journal);
    expect(
      "subagentModel" in journal.listEvents(RUN, { types: "all", reportItems: "all" })[1]!.event,
    ).toBe(false);
  });

  it("launch 携 scriptPath 时 run-launched 原样带上绝对路径，resume 不再记第二条", () => {
    const journal = new InMemoryJournalStore();
    const withPath = () =>
      new WorkflowEngine({
        runId: RUN,
        driver: new FakeDriver(journal),
        caps: { maxConcurrency: 16 },
        askSpecs: untypedSpecs("ask#1"),
        validate: () => [],
        launch: {
          inputId: "launch-input-4",
          scriptPath: "/repo/.cf/workflow-drafts/audit.dwf.ts",
        },
      });
    withPath();
    expect(journal.listEvents(RUN, { types: "all", reportItems: "all" })[1]?.event).toEqual({
      type: "run-launched",
      inputId: "launch-input-4",
      scriptPath: "/repo/.cf/workflow-drafts/audit.dwf.ts",
    });

    withPath();
    expect(
      journal
        .listEvents(RUN, { types: "all", reportItems: "all" })
        .filter((stored) => stored.event.type === "run-launched"),
    ).toHaveLength(1);
  });

  it("launch 不带 scriptPath 时整个键缺席（缺席即这个 run 没有可编辑的脚本文件）", () => {
    const journal = new InMemoryJournalStore();
    make(journal);
    expect(
      "scriptPath" in journal.listEvents(RUN, { types: "all", reportItems: "all" })[1]!.event,
    ).toBe(false);
  });

  it("scriptPath 与子代理模型、阶段表同车时四者共存于同一条 run-launched", () => {
    const journal = new InMemoryJournalStore();
    new WorkflowEngine({
      runId: RUN,
      driver: new FakeDriver(journal),
      caps: { maxConcurrency: 16 },
      askSpecs: untypedSpecs("ask#1"),
      validate: () => [],
      launch: {
        inputId: "launch-input-5",
        phaseNames: ["Research"],
        subagentModel: "zhipu/glm-5.3-flash$high",
        scriptPath: "/repo/.cf/workflow-drafts/audit.dwf.ts",
      },
    });
    expect(journal.listEvents(RUN, { types: "all", reportItems: "all" })[1]?.event).toEqual({
      type: "run-launched",
      inputId: "launch-input-5",
      phaseNames: ["Research"],
      subagentModel: "zhipu/glm-5.3-flash$high",
      scriptPath: "/repo/.cf/workflow-drafts/audit.dwf.ts",
    });
  });

  it("phaseAlongside 与阶段表同车落 journal，缺席时键不出现（引擎两者都不读）", () => {
    const journal = new InMemoryJournalStore();
    new WorkflowEngine({
      runId: RUN,
      driver: new FakeDriver(journal),
      caps: { maxConcurrency: 16 },
      askSpecs: untypedSpecs("ask#1"),
      validate: () => [],
      launch: {
        inputId: "launch-input-3",
        phaseNames: ["A", "B", "C"],
        phaseAlongside: [[], [0], []],
      },
    });
    expect(journal.listEvents(RUN, { types: "all", reportItems: "all" })[1]?.event).toEqual({
      type: "run-launched",
      inputId: "launch-input-3",
      phaseNames: ["A", "B", "C"],
      phaseAlongside: [[], [0], []],
    });

    const straight = new InMemoryJournalStore();
    new WorkflowEngine({
      runId: RUN,
      driver: new FakeDriver(straight),
      caps: { maxConcurrency: 16 },
      askSpecs: untypedSpecs("ask#1"),
      validate: () => [],
      launch: { inputId: "launch-input-4", phaseNames: ["A"] },
    });
    expect(
      Object.hasOwn(
        straight.listEvents(RUN, { types: "all", reportItems: "all" })[1]!.event,
        "phaseAlongside",
      ),
    ).toBe(false);
  });
});

describe("Usage accumulates along lineage (docs/execution-engine.md \'Usage across the lineage\')", () => {
  const eventTypes = (journal: InMemoryJournalStore) =>
    journal
      .listEvents(RUN, { types: "all", reportItems: "all" })
      .map((stored) => stored.event.type);
  const make = (
    journal: InMemoryJournalStore,
    opts: { inheritedTokens?: number; launch?: { inputId: string } } = {},
  ) => {
    const driver = new FakeDriver(journal);
    const engine = new WorkflowEngine({
      runId: RUN,
      driver,
      caps: { maxConcurrency: 16 },
      askSpecs: untypedSpecs("ask#1"),
      validate: () => [],
      resumedFrom: "run-a",
      ...(opts.inheritedTokens === undefined ? {} : { inheritedTokens: opts.inheritedTokens }),
      ...(opts.launch === undefined ? {} : { launch: opts.launch }),
    });
    return { driver, engine };
  };

  it("inheritedTokens 是新 run 的起点：行值即前驱总量，run-started 之后紧跟一条同值的 usage-updated", () => {
    const journal = new InMemoryJournalStore();
    const { driver } = make(journal, { inheritedTokens: 300 });
    expect(journal.getRun(RUN)?.spentTokens).toBe(300);
    expect(eventTypes(journal)).toEqual(["run-started", "usage-updated"]);
    expect(journal.listEvents(RUN, { types: "all", reportItems: "all" })[1]?.event).toEqual({
      type: "usage-updated",
      spentTokens: 300,
    });
    expect(driver.events.at(-1)).toEqual({ type: "usage-updated", spentTokens: 300 });
  });

  it("带 launch 时顺序是 run-started → run-launched → usage-updated（锚点仍紧跟首条 run-started）", () => {
    const journal = new InMemoryJournalStore();
    make(journal, { inheritedTokens: 300, launch: { inputId: "launch-1" } });
    expect(eventTypes(journal)).toEqual(["run-started", "run-launched", "usage-updated"]);
  });

  it("live turn 在继承值之上累加；事件载荷与行值始终相等", async () => {
    const journal = new InMemoryJournalStore();
    const { driver, engine } = make(journal, { inheritedTokens: 300 });
    const actor = engine.createActor("actor#1");
    void engine.ask("ask#1", actor, "do it").catch(() => {});
    await flush();
    engine.askStats(inst("ask#1"), { tokens: 50, toolCalls: 0, turns: 1 });
    expect(driver.events.at(-1)).toEqual({ type: "usage-updated", spentTokens: 350 });
    expect(journal.getRun(RUN)?.spentTokens).toBe(350);
    engine.stop("user");
  });

  it("继承值为零或缺席时不发 post-start usage-updated（reset 已经说了零）", () => {
    const zero = new InMemoryJournalStore();
    make(zero, { inheritedTokens: 0 });
    expect(eventTypes(zero)).toEqual(["run-started"]);
    const absent = new InMemoryJournalStore();
    make(absent);
    expect(absent.getRun(RUN)?.spentTokens).toBe(0);
    expect(eventTypes(absent)).toEqual(["run-started"]);
  });

  it("After resume restores row values, it is likewise immediately followed by a usage-updated so the second incarnation\'s projection does not display from zero", () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 7,
      status: "stopped",
      stopReason: "user",
    });
    const { driver } = make(journal);
    expect(eventTypes(journal)).toEqual(["run-started", "usage-updated"]);
    expect(driver.events).toEqual([
      { type: "run-started", runId: RUN, caps: { maxConcurrency: 16 } },
      { type: "usage-updated", spentTokens: 7 },
    ]);
    expect(journal.getRun(RUN)?.spentTokens).toBe(7);
  });
});
