

import { describe, expect, it } from "vitest";
import {
  InMemoryJournalStore,
  WorkflowEngine,
  inputHash,
  type AskSpec,
  type AskStats,
  type Caps,
  type ImportedActorCandidate,
  type ImportedAskEntry,
  type ImportedRunCache,
  type ImportedWorldEntry,
  type NodeRecord,
  type PersonaSpec,
  type WorldReadOp,
} from "../../src/engine/index.js";
import { FakeDriver, flush } from "./fake-driver.js";

const RUN = "run-b";

const untypedSpecs = (...siteIds: string[]): Map<string, AskSpec> =>
  new Map(siteIds.map((id) => [id, { typed: false } as AskSpec]));

const ASK_SITES = untypedSpecs("ask#1", "ask#2", "ask#3", "ask#4", "ask#5", "ask#6", "ask#7");

interface SetupOpts {
  journal?: InMemoryJournalStore;
  caps?: Caps;
  importedCache?: ImportedRunCache;
  inheritedTokens?: number;
}

function setup(opts: SetupOpts = {}) {
  const journal = opts.journal ?? new InMemoryJournalStore();
  const driver = new FakeDriver(journal);
  const engine = new WorkflowEngine({
    runId: RUN,
    driver,
    caps: opts.caps ?? { maxConcurrency: 16 },
    askSpecs: ASK_SITES,
    validate: () => [],
    resumedFrom: "run-a",
    ...(opts.importedCache === undefined ? {} : { importedCache: opts.importedCache }),
    ...(opts.inheritedTokens === undefined ? {} : { inheritedTokens: opts.inheritedTokens }),
  });
  return { journal, driver, engine };
}

function entry(
  instructions: string,
  result: unknown,
  messageBoundary: number,
  stats?: AskStats,
): ImportedAskEntry {
  return {
    inputHash: inputHash(instructions),
    result,
    messageBoundary,
    ...(stats === undefined ? {} : { stats }),
  };
}

function candidate(
  entries: ImportedAskEntry[],
  overrides: Partial<ImportedActorCandidate> = {},
): ImportedActorCandidate {
  return {
    persona: { name: "planner" },
    entries,
    transcriptSourceSessionId: "sess-a",
    resolvedModel: "zhipu/glm-5.3",
    ...overrides,
  };
}

const worldKey = (op: WorldReadOp, args: unknown[]): string => inputHash({ op, args });

function worldEntry(op: WorldReadOp, args: unknown[], result: unknown): ImportedWorldEntry {
  return {
    inputHash: worldKey(op, args),
    kind: op === "run" ? "world-run" : "world-read",
    result,
  };
}

function cacheOf(
  actors: Array<[string, ImportedActorCandidate]>,
  world: Array<[string, ImportedWorldEntry[]]> = [],
): ImportedRunCache {
  return { actors: new Map(actors), world: new Map(world) };
}

describe("导入缓存 — 全命中", () => {
  it("零 driver 往返；节点行拷贝 result/stats/边界；事件只有 node-settled(cached)", async () => {
    const cache = cacheOf(
      [
        [
          "planner",
          candidate([
            entry("step 1", "r1", 4, { tokens: 10, toolCalls: 1, turns: 2 }),
            entry("step 2", "r2", 9),
          ]),
        ],
      ],
      [[worldKey("grep", ["todo"]), [worldEntry("grep", ["todo"], ["a.ts"])]]],
    );
    const { engine, driver, journal } = setup({ importedCache: cache });

    const planner = engine.createActor("actor#1", "planner");
    const p1 = engine.ask("ask#1", planner, "step 1");
    const p2 = engine.ask("ask#2", planner, "step 2");
    const w = engine.worldRead("world#1", "grep", ["todo"]);
    await flush();

    await expect(p1).resolves.toBe("r1");
    await expect(p2).resolves.toBe("r2");
    await expect(w).resolves.toEqual(["a.ts"]);

    expect(driver.sessionCreations).toHaveLength(0);
    expect(driver.startAskCount()).toBe(0);
    expect(driver.worldReads).toHaveLength(0);

    const settled = driver.eventsOfType("node-settled");
    expect(settled).toHaveLength(3);
    expect(settled.every((e) => e.cached === true)).toBe(true);
    expect(driver.eventsOfType("node-queued")).toHaveLength(0);
    expect(driver.eventsOfType("node-dispatched")).toHaveLength(0);

    expect(journal.getNode(RUN, "ask#1", 1)).toMatchObject({
      kind: "ask",
      status: "completed",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 0,
      inputHash: inputHash("step 1"),
      result: "r1",
      messageBoundary: 4,
      stats: { tokens: 10, toolCalls: 1, turns: 2 },
    });
    const second = journal.getNode(RUN, "ask#2", 1);
    expect(second).toMatchObject({ actorSeq: 1, result: "r2", messageBoundary: 9 });
    expect(second?.stats).toBeUndefined();
    expect(journal.getNode(RUN, "world#1", 1)).toMatchObject({
      kind: "world-read",
      status: "completed",
      result: ["a.ts"],
    });

    engine.complete("done");
    await expect(engine.settled).resolves.toEqual({ status: "completed", artifact: "done" });
  });
});

describe("Import cache — hit settlements re-emit provenance facts (docs/execution-engine.md \"Events\")", () => {
  it("ask 命中：kind / actor / actorSeq / 任务摘要 + 前驱会话；world 命中照旧是裸的", async () => {
    const cache = cacheOf(
      [["planner", candidate([entry("  step 1  ", "r1", 4), entry("step 2", "r2", 9)])]],
      [[worldKey("grep", ["todo"]), [worldEntry("grep", ["todo"], ["a.ts"])]]],
    );
    const { engine, driver } = setup({ importedCache: cache });

    const planner = engine.createActor("actor#1", "planner");
    const p1 = engine.ask("ask#1", planner, "  step 1  ");
    const p2 = engine.ask("ask#2", planner, "step 2");
    const w = engine.worldRead("world#1", "grep", ["todo"]);
    await flush();
    await Promise.all([p1, p2, w]);

    expect(driver.eventsOfType("node-settled")).toEqual([
      {
        type: "node-settled",
        instance: { siteId: "ask#1", ordinal: 1 },
        outcome: "ok",
        cached: true,
        kind: "ask",
        actor: { siteId: "actor#1", ordinal: 1 },
        actorSeq: 0,
        instructionsHead: "step 1",
        sourceSessionId: "sess-a",
      },
      {
        type: "node-settled",
        instance: { siteId: "ask#2", ordinal: 1 },
        outcome: "ok",
        cached: true,
        kind: "ask",
        actor: { siteId: "actor#1", ordinal: 1 },
        actorSeq: 1,
        instructionsHead: "step 2",
        sourceSessionId: "sess-a",
      },
      { type: "node-settled", instance: { siteId: "world#1", ordinal: 1 }, outcome: "ok", cached: true },
    ]);
  });

  it("命中之后分歧的 live ask 走 node-queued；它前面的命中仍指向前驱会话", async () => {
    const cache = cacheOf([["planner", candidate([entry("s0", "r0", 4), entry("Old instruction", "r1", 9)])]]);
    const { engine, driver } = setup({ importedCache: cache });
    const planner = engine.createActor("actor#1", "planner");
    const p0 = engine.ask("ask#1", planner, "s0");
    const p1 = engine.ask("ask#2", planner, "New instruction");
    await flush();
    await expect(p0).resolves.toBe("r0");

    const cachedSettles = driver.eventsOfType("node-settled").filter((e) => e.cached === true);
    expect(cachedSettles).toHaveLength(1);
    expect(cachedSettles[0]).toMatchObject({ actorSeq: 0, sourceSessionId: "sess-a" });
    expect(driver.eventsOfType("node-queued")).toMatchObject([
      { instance: { siteId: "ask#2", ordinal: 1 }, actorSeq: 1 },
    ]);
    engine.askTurnEnded({ siteId: "ask#2", ordinal: 1 }, "live-1");
    await expect(p1).resolves.toBe("live-1");
    const liveSettle = driver.eventsOfType("node-settled").find((e) => e.instance.siteId === "ask#2");
    expect(liveSettle).toEqual({
      type: "node-settled",
      instance: { siteId: "ask#2", ordinal: 1 },
      outcome: "ok",
    });
  });
});

describe("导入缓存 — 分歧", () => {
  it("Midway divergence: hit prefix is preserved, fully live from the divergence point onward, suffix is no longer checked even if hash matches", async () => {
    const cache = cacheOf([
      ["planner", candidate([entry("s0", "r0", 4), entry("Old instruction", "r1", 9), entry("s2", "r2", 14)])],
    ]);
    const { engine, driver, journal } = setup({ importedCache: cache });

    const planner = engine.createActor("actor#1", "planner");
    const p0 = engine.ask("ask#1", planner, "s0");
    const p1 = engine.ask("ask#2", planner, "s1");
    const p2 = engine.ask("ask#3", planner, "s2");
    await flush();

    await expect(p0).resolves.toBe("r0");
    expect(journal.getNode(RUN, "ask#1", 1)).toMatchObject({ status: "completed", result: "r0" });

    expect(driver.sessionCreations).toHaveLength(1);
    expect(driver.sessionSeeds[0]).toEqual({
      sourceSessionId: "sess-a",
      messageCount: 4,
      resolvedModel: "zhipu/glm-5.3",
    });

    expect(driver.startAskCount()).toBe(1);
    expect(driver.startAsks[0]?.instance.siteId).toBe("ask#2");
    engine.askTurnEnded({ siteId: "ask#2", ordinal: 1 }, "live-1");
    await flush();
    await expect(p1).resolves.toBe("live-1");

    expect(driver.startAskCount()).toBe(2);
    expect(driver.startAsks[1]?.instance.siteId).toBe("ask#3");
    engine.askTurnEnded({ siteId: "ask#3", ordinal: 1 }, "live-2");
    await expect(p2).resolves.toBe("live-2");
    expect(journal.getNode(RUN, "ask#3", 1)?.result).toBe("live-2");
    expect(driver.eventsOfType("node-settled").filter((e) => e.cached === true)).toHaveLength(1);
  });

  it("Out-of-bounds expansion: new asks added after import entries are exhausted turn live, seed boundary takes the last entry", async () => {
    const cache = cacheOf([["planner", candidate([entry("s0", "r0", 7)])]]);
    const { engine, driver } = setup({ importedCache: cache });

    const planner = engine.createActor("actor#1", "planner");
    const p0 = engine.ask("ask#1", planner, "s0");
    const p1 = engine.ask("ask#2", planner, "s1");
    await flush();

    await expect(p0).resolves.toBe("r0");
    expect(driver.startAskCount()).toBe(1);
    expect(driver.startAsks[0]?.instance.siteId).toBe("ask#2");
    expect(driver.sessionSeeds[0]).toEqual({
      sourceSessionId: "sess-a",
      messageCount: 7,
      resolvedModel: "zhipu/glm-5.3",
    });

    engine.askTurnEnded({ siteId: "ask#2", ordinal: 1 }, "live");
    await expect(p1).resolves.toBe("live");
  });
});

describe("导入缓存 — actor 附着", () => {
  it("persona mismatch = brand new actor: do not attach candidate, fully live, create session without seed", async () => {
    const cache = cacheOf([
      ["planner", candidate([entry("s0", "r0", 4)], { persona: { name: "planner", system: "旧 prompt" } })],
    ]);
    const { engine, driver } = setup({ importedCache: cache });

    const planner = engine.createActor("actor#1", "planner", "新 prompt");
    const p0 = engine.ask("ask#1", planner, "s0");
    await flush();

    expect(driver.startAskCount()).toBe(1);
    expect(driver.sessionCreations).toHaveLength(1);
    expect(driver.sessionSeeds[0]).toBeUndefined();
    expect(driver.eventsOfType("node-settled").filter((e) => e.cached === true)).toHaveLength(0);

    engine.askTurnEnded({ siteId: "ask#1", ordinal: 1 }, "live");
    await expect(p0).resolves.toBe("live");
  });

  it("persona comparison is normalized: missing members equal explicit undefined", async () => {
    const persona: PersonaSpec = { name: "planner", system: undefined };
    const cache = cacheOf([["planner", candidate([entry("s0", "r0", 4)], { persona })]]);
    const { engine, driver } = setup({ importedCache: cache });

    const planner = engine.createActor("actor#1", "planner");
    await expect(engine.ask("ask#1", planner, "s0")).resolves.toBe("r0");
    expect(driver.startAskCount()).toBe(0);
  });

  it("Changing only persona's model: still attaches, still hits; persisted persona carries the new model name", async () => {
    const cache = cacheOf([
      [
        "planner",
        candidate([entry("s0", "r0", 4)], {
          persona: { name: "planner", system: "你负责规划。", model: "GLM-5.3" },
        }),
      ],
    ]);
    const { engine, driver, journal } = setup({ importedCache: cache });

    const planner = engine.createActor("actor#1", "planner", {
      system: "你负责规划。",
      model: "GLM-5.3-Flash",
    });
    await expect(engine.ask("ask#1", planner, "s0")).resolves.toBe("r0");
    expect(driver.startAskCount()).toBe(0);
    expect(journal.getActor(RUN, "actor#1", 1)?.persona).toEqual({
      name: "planner",
      system: "你负责规划。",
      model: "GLM-5.3-Flash",
    });
  });

  it("Model appearing from nothing also does not break attachment; attachment is still broken if system changes", async () => {
    const cache = cacheOf([
      ["planner", candidate([entry("s0", "r0", 4)], { persona: { name: "planner" } })],
      ["judge", candidate([entry("j0", "v0", 4)], { persona: { name: "judge", system: "旧" } })],
    ]);
    const { engine, driver } = setup({ importedCache: cache });

    const planner = engine.createActor("actor#1", "planner", { model: "GLM-5.3-Flash" });
    const judge = engine.createActor("actor#2", "judge", { system: "新", model: "GLM-5.3-Flash" });
    await expect(engine.ask("ask#1", planner, "s0")).resolves.toBe("r0");
    const live = engine.ask("ask#2", judge, "j0");
    await flush();
    expect(driver.startAskCount()).toBe(1);
    engine.askTurnEnded({ siteId: "ask#2", ordinal: 1 }, "live");
    await expect(live).resolves.toBe("live");
  });

  it("Anonymous actor never attaches (name is the cache identity key)", async () => {
    const cache = cacheOf([["planner", candidate([entry("s0", "r0", 4)])]]);
    const { engine, driver } = setup({ importedCache: cache });

    const anon = engine.createActor("actor#1");
    const p0 = engine.ask("ask#1", anon, "s0");
    await flush();

    expect(driver.startAskCount()).toBe(1);
    expect(driver.sessionSeeds[0]).toBeUndefined();
    engine.askTurnEnded({ siteId: "ask#1", ordinal: 1 }, "live");
    await expect(p0).resolves.toBe("live");
  });
});

describe("Import cache — world nodes", () => {
  it("The nth occurrence of the same {op,args} matches the nth entry; turns live upon exhaustion or parameter change", async () => {
    const cache = cacheOf(
      [],
      [
        [
          worldKey("grep", ["x"]),
          [worldEntry("grep", ["x"], "第一次"), worldEntry("grep", ["x"], "第二次")],
        ],
      ],
    );
    const { engine, driver } = setup({ importedCache: cache });

    await expect(engine.worldRead("world#1", "grep", ["x"])).resolves.toBe("第一次");
    await expect(engine.worldRead("world#1", "grep", ["x"])).resolves.toBe("第二次");
    expect(driver.worldReads).toHaveLength(0);

    const third = engine.worldRead("world#1", "grep", ["x"]);
    expect(driver.worldReads).toHaveLength(1);
    driver.worldReads[0]?.deferred.resolve("Live read");
    await expect(third).resolves.toBe("Live read");

    const other = engine.worldRead("world#2", "grep", ["y"]);
    expect(driver.worldReads).toHaveLength(2);
    driver.worldReads[1]?.deferred.resolve("y 的结果");
    await expect(other).resolves.toBe("y 的结果");
  });

  it("world-run hit never touches executeWorldRead (effects are not silently replayed), row kind is world-run", async () => {
    const cache = cacheOf(
      [],
      [[worldKey("run", ["deploy.sh"]), [worldEntry("run", ["deploy.sh"], { exitCode: 0 })]]],
    );
    const { engine, driver, journal } = setup({ importedCache: cache });

    await expect(engine.worldRead("world#1", "run", ["deploy.sh"])).resolves.toEqual({ exitCode: 0 });
    expect(driver.worldReads).toHaveLength(0);
    expect(journal.getNode(RUN, "world#1", 1)).toMatchObject({
      kind: "world-run",
      status: "completed",
      inputHash: worldKey("run", ["deploy.sh"]),
      result: { exitCode: 0 },
    });
  });
});

describe("导入缓存 — 崩溃后 resume 的分歧重建", () => {
  it("Deduce divergence point seq by seq from journal rows: actors that diverged in the original run will not be accidentally hit by suffix hash", async () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
      resumedFrom: "run-a",
    });
    const recordedAsk = (siteId: string, seq: number, instructions: string): NodeRecord => ({
      runId: RUN,
      siteId,
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: seq,
      inputHash: inputHash(instructions),
      status: "completed",
      result: `journal-${seq}`,
    });
    journal.putNode(recordedAsk("ask#1", 0, "s0"));
    journal.putNode(recordedAsk("ask#2", 1, "s1"));
    journal.putNode(recordedAsk("ask#3", 2, "s2"));

    const cache = cacheOf([
      [
        "planner",
        candidate([
          entry("s0", "r0", 4),
          entry("Old instruction differing from the new script", "r1", 9),
          entry("s2", "r2", 14),
          entry("s3", "r3", 19),
        ]),
      ],
    ]);
    const { engine, driver } = setup({ journal, importedCache: cache });

    const planner = engine.createActor("actor#1", "planner");
    const p0 = engine.ask("ask#1", planner, "s0");
    const p1 = engine.ask("ask#2", planner, "s1");
    const p2 = engine.ask("ask#3", planner, "s2");
    const p3 = engine.ask("ask#4", planner, "s3");
    await flush();

    await expect(p0).resolves.toBe("journal-0");
    await expect(p1).resolves.toBe("journal-1");
    await expect(p2).resolves.toBe("journal-2");

    expect(
      driver
        .eventsOfType("node-settled")
        .filter((e) => e.cached === true)
        .map((e) => ({ seq: e.actorSeq, actor: e.actor, kind: e.kind, source: e.sourceSessionId })),
    ).toEqual([
      { seq: 0, actor: { siteId: "actor#1", ordinal: 1 }, kind: "ask", source: "sess-a" },
      { seq: 1, actor: { siteId: "actor#1", ordinal: 1 }, kind: "ask", source: undefined },
      { seq: 2, actor: { siteId: "actor#1", ordinal: 1 }, kind: "ask", source: undefined },
    ]);

    expect(driver.startAskCount()).toBe(1);
    expect(driver.startAsks[0]?.instance.siteId).toBe("ask#4");
    expect(driver.sessionSeeds[0]).toEqual({
      sourceSessionId: "sess-a",
      messageCount: 4,
      resolvedModel: "zhipu/glm-5.3",
    });

    engine.askTurnEnded({ siteId: "ask#4", ordinal: 1 }, "live-3");
    await expect(p3).resolves.toBe("live-3");
  });
});

describe("Import cache — closed (before the first write, not the first live ask)", () => {
  const NPM_TEST = ["npm", ["test"]];
  const README = ["README.md"];
  const PURE: AskStats = { tokens: 10, toolCalls: 1, turns: 1, worldToolCalls: 0 };
  const TOOLED: AskStats = { tokens: 10, toolCalls: 3, turns: 1, worldToolCalls: 2 };

  
  function closingCache(): ImportedRunCache {
    return cacheOf(
      [
        ["planner", candidate([entry("plan", "r-plan", 4, PURE)])],
        [
          "fixer",
          candidate([entry("Old fix instruction", "r-old-fix", 5, TOOLED)], { persona: { name: "fixer" } }),
        ],
        [
          "reviewer",
          candidate(
            [entry("review-1", "r-review-1", 6, TOOLED), entry("review-2", "r-review-2", 11, TOOLED)],
            { persona: { name: "reviewer" } },
          ),
        ],
        [
          "summarizer",
          candidate([entry("summarize", "r-sum", 7, PURE), entry("summarize-2", "r-sum-2", 9, PURE)], {
            persona: { name: "summarizer" },
          }),
        ],
      ],
      [
        [
          worldKey("run", NPM_TEST),
          [worldEntry("run", NPM_TEST, { exitCode: 0, round: 1 }), worldEntry("run", NPM_TEST, { exitCode: 0, round: 2 })],
        ],
        [worldKey("read", README), [worldEntry("read", README, "old readme")]],
      ],
    );
  }

  const closedEvents = (driver: FakeDriver) => driver.eventsOfType("import-cache-closed");

  it("The first missed ask in a fan-out turning live does not close the door: siblings queued behind it hit as usual (two missed hits observed in testing on 2026-09-14)", async () => {
    const { engine, driver } = setup({ importedCache: closingCache() });
    const fixer = engine.createActor("actor#2", "fixer");
    const planner = engine.createActor("actor#1", "planner");
    const reviewer = engine.createActor("actor#3", "reviewer");

    const fix = engine.ask("ask#3", fixer, "修好 parser");
    const plan = engine.ask("ask#1", planner, "plan");
    const review = engine.ask("ask#2", reviewer, "review-1");
    const test = engine.worldRead("world#1", "run", NPM_TEST);
    await flush();
    await expect(plan).resolves.toBe("r-plan");
    await expect(review).resolves.toBe("r-review-1");
    await expect(test).resolves.toEqual({ exitCode: 0, round: 1 });
    expect(driver.startAskCount()).toBe(1);
    expect(driver.startAsks[0]?.instance.siteId).toBe("ask#3");
    expect(driver.worldReads).toHaveLength(0);
    expect(closedEvents(driver)).toHaveLength(0);
    expect(driver.eventsOfType("log")).toHaveLength(0);

    engine.askTurnEnded({ siteId: "ask#3", ordinal: 1 }, "fixed");
    await expect(fix).resolves.toBe("fixed");
  });

  it("askMutating closes the door: subsequent entries with tools and world nodes are fully live, pure ask still hits; exactly one import-cache-closed", async () => {
    const { engine, driver } = setup({ importedCache: closingCache() });
    const fixer = engine.createActor("actor#2", "fixer");
    const reviewer = engine.createActor("actor#3", "reviewer");
    const summarizer = engine.createActor("actor#4", "summarizer");

    await expect(engine.ask("ask#2", reviewer, "review-1")).resolves.toBe("r-review-1");

    const fix = engine.ask("ask#3", fixer, "修好 parser");
    await flush();
    expect(driver.startAskCount()).toBe(1);
    expect(closedEvents(driver)).toHaveLength(0);
    engine.askMutating({ siteId: "ask#3", ordinal: 1 });
    const closed = closedEvents(driver);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      instance: { siteId: "ask#3", ordinal: 1 },
      cause: "mutating-tool",
      actorName: "fixer",
    });
    engine.askMutating({ siteId: "ask#3", ordinal: 1 });
    expect(closedEvents(driver)).toHaveLength(1);

    const rerun = engine.worldRead("world#1", "run", NPM_TEST);
    expect(driver.worldReads).toHaveLength(1);
    driver.worldReads[0]?.deferred.resolve({ exitCode: 1, round: "live" });
    await expect(rerun).resolves.toEqual({ exitCode: 1, round: "live" });
    const readme = engine.worldRead("world#2", "read", README);
    expect(driver.worldReads).toHaveLength(2);
    driver.worldReads[1]?.deferred.resolve("new readme");
    await expect(readme).resolves.toBe("new readme");

    const review2 = engine.ask("ask#4", reviewer, "review-2");
    await flush();
    expect(driver.startAskCount()).toBe(2);
    expect(driver.startAsks[1]?.instance.siteId).toBe("ask#4");
    const reviewerSeed = driver.sessionSeeds[driver.sessionCreations.findIndex((ref) => ref.siteId === "actor#3")];
    expect(reviewerSeed).toEqual({ sourceSessionId: "sess-a", messageCount: 6, resolvedModel: "zhipu/glm-5.3" });

    await expect(engine.ask("ask#5", summarizer, "summarize")).resolves.toBe("r-sum");
    await expect(engine.ask("ask#5", summarizer, "summarize-2")).resolves.toBe("r-sum-2");
    expect(driver.startAskCount()).toBe(2);

    engine.askTurnEnded({ siteId: "ask#3", ordinal: 1 }, "fixed");
    await expect(fix).resolves.toBe("fixed");
    engine.askTurnEnded({ siteId: "ask#4", ordinal: 1 }, "reviewed");
    await expect(review2).resolves.toBe("reviewed");
    expect(closedEvents(driver)).toHaveLength(1);
  });

  it("Old entries (no worldToolCalls in stats) are treated as \"touched\" after door closes: conservatively turn live", async () => {
    const legacy = cacheOf([
      ["planner", candidate([entry("plan", "r-plan", 4, { tokens: 5, toolCalls: 1, turns: 1 })])],
      ["fixer", candidate([entry("Old fix instruction", "r-old-fix", 5, TOOLED)], { persona: { name: "fixer" } })],
    ]);
    const { engine, driver } = setup({ importedCache: legacy });
    const fixer = engine.createActor("actor#2", "fixer");
    const planner = engine.createActor("actor#1", "planner");
    const fix = engine.ask("ask#3", fixer, "修好 parser");
    await flush();
    engine.askMutating({ siteId: "ask#3", ordinal: 1 });

    const plan = engine.ask("ask#1", planner, "plan");
    await flush();
    expect(driver.startAskCount()).toBe(2);
    engine.askTurnEnded({ siteId: "ask#1", ordinal: 1 }, "planned live");
    await expect(plan).resolves.toBe("planned live");
    engine.askTurnEnded({ siteId: "ask#3", ordinal: 1 }, "fixed");
    await expect(fix).resolves.toBe("fixed");
  });

  it("Once an entry in a pure actor chain turns live after the door closes, suffix entries no longer hit even if pure (transcript has diverged)", async () => {
    const { engine, driver } = setup({ importedCache: closingCache() });
    const fixer = engine.createActor("actor#2", "fixer");
    const summarizer = engine.createActor("actor#4", "summarizer");

    const fix = engine.ask("ask#3", fixer, "修好 parser");
    await flush();
    engine.askMutating({ siteId: "ask#3", ordinal: 1 });

    const sum1 = engine.ask("ask#5", summarizer, "Summarize in another way");
    await flush();
    expect(driver.startAskCount()).toBe(2);
    engine.askTurnEnded({ siteId: "ask#5", ordinal: 1 }, "summary");
    await expect(sum1).resolves.toBe("summary");
    const sum2 = engine.ask("ask#5", summarizer, "summarize-2");
    await flush();
    expect(driver.startAskCount()).toBe(3);
    engine.askTurnEnded({ siteId: "ask#5", ordinal: 2 }, "summary-2");
    await expect(sum2).resolves.toBe("summary-2");

    engine.askTurnEnded({ siteId: "ask#3", ordinal: 1 }, "fixed");
    await expect(fix).resolves.toBe("fixed");
  });

  it("askMutating is a no-op for non-in-flight instances: late observations do not close the door", async () => {
    const { engine, driver } = setup({ importedCache: closingCache() });
    const planner = engine.createActor("actor#1", "planner");
    await expect(engine.ask("ask#1", planner, "plan")).resolves.toBe("r-plan");
    engine.askMutating({ siteId: "ask#1", ordinal: 1 });
    engine.askMutating({ siteId: "ask#9", ordinal: 1 });
    expect(closedEvents(driver)).toHaveLength(0);
    await expect(engine.worldRead("world#1", "run", NPM_TEST)).resolves.toEqual({ exitCode: 0, round: 1 });
  });

  it("A live world-run is a write: closes the door before dispatch; live world-read does not close", async () => {
    const { engine, driver } = setup({ importedCache: closingCache() });
    const summarizer = engine.createActor("actor#4", "summarizer");
    const reviewer = engine.createActor("actor#3", "reviewer");

    const peek = engine.worldRead("world#4", "read", ["CHANGELOG.md"]);
    expect(driver.worldReads).toHaveLength(1);
    driver.worldReads[0]?.deferred.resolve("changelog");
    await expect(peek).resolves.toBe("changelog");
    await expect(engine.worldRead("world#2", "read", README)).resolves.toBe("old readme");
    expect(closedEvents(driver)).toHaveLength(0);

    const patch = engine.worldRead("world#3", "run", ["sed", ["-i", "s/a/b/", "x.ts"]]);
    expect(driver.worldReads).toHaveLength(2);
    const closedAt = driver.events.findIndex((e) => e.type === "import-cache-closed");
    const queuedAt = driver.events.findIndex(
      (e) => e.type === "node-queued" && e.instance.siteId === "world#3",
    );
    expect(closedAt).toBeGreaterThanOrEqual(0);
    expect(closedAt).toBeLessThan(queuedAt);
    expect(closedEvents(driver)[0]).toMatchObject({ instance: { siteId: "world#3", ordinal: 1 }, cause: "world-run" });
    driver.worldReads[1]?.deferred.resolve({ exitCode: 0 });
    await expect(patch).resolves.toEqual({ exitCode: 0 });

    const rerun = engine.worldRead("world#1", "run", NPM_TEST);
    expect(driver.worldReads).toHaveLength(3);
    driver.worldReads[2]?.deferred.resolve({ exitCode: 1, round: "live" });
    await expect(rerun).resolves.toEqual({ exitCode: 1, round: "live" });
    const review = engine.ask("ask#2", reviewer, "review-1");
    await flush();
    expect(driver.startAskCount()).toBe(1);
    await expect(engine.ask("ask#5", summarizer, "summarize")).resolves.toBe("r-sum");
    engine.askTurnEnded({ siteId: "ask#2", ordinal: 1 }, "reviewed");
    await expect(review).resolves.toBe("reviewed");
  });

  it("Resume after crash: restores \"closed\" from import-cache-closed event; previously live ask rows do not advance the consumption cursor", async () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({ runId: RUN, caps: { maxConcurrency: 16 }, spentTokens: 0, status: "running", resumedFrom: "run-a" });
    journal.putActor({ runId: RUN, siteId: "actor#2", ordinal: 1, name: "fixer", persona: { name: "fixer" } });
    journal.putActor({
      runId: RUN,
      siteId: "actor#3",
      ordinal: 1,
      name: "reviewer",
      persona: { name: "reviewer" },
    });
    const row = (siteId: string, actor: [string, number], seq: number, instructions: string): NodeRecord => ({
      runId: RUN,
      siteId,
      ordinal: 1,
      kind: "ask",
      actorSiteId: actor[0],
      actorOrdinal: actor[1],
      actorSeq: seq,
      inputHash: inputHash(instructions),
      status: "completed",
      result: `journal-${siteId}`,
    });
    journal.putNode(row("ask#2", ["actor#3", 1], 0, "review-1"));
    journal.putNode(row("ask#3", ["actor#2", 1], 0, "修好 parser"));
    journal.putNode(row("ask#4", ["actor#3", 1], 1, "review-2"));
    journal.appendEvent(RUN, {
      type: "node-queued",
      instance: { siteId: "ask#3", ordinal: 1 },
      kind: "ask",
      actor: { siteId: "actor#2", ordinal: 1 },
      actorSeq: 0,
    });
    journal.appendEvent(RUN, {
      type: "import-cache-closed",
      instance: { siteId: "ask#3", ordinal: 1 },
      cause: "mutating-tool",
      actorName: "fixer",
    });
    journal.appendEvent(RUN, {
      type: "node-queued",
      instance: { siteId: "ask#4", ordinal: 1 },
      kind: "ask",
      actor: { siteId: "actor#3", ordinal: 1 },
      actorSeq: 1,
    });

    const { engine, driver } = setup({ journal, importedCache: closingCache() });
    const fixer = engine.createActor("actor#2", "fixer");
    const reviewer = engine.createActor("actor#3", "reviewer");

    await expect(engine.ask("ask#2", reviewer, "review-1")).resolves.toBe("journal-ask#2");
    await expect(engine.ask("ask#3", fixer, "修好 parser")).resolves.toBe("journal-ask#3");
    await expect(engine.ask("ask#4", reviewer, "review-2")).resolves.toBe("journal-ask#4");
    expect(closedEvents(driver)).toHaveLength(0);
    expect(
      driver
        .eventsOfType("node-settled")
        .filter((e) => e.cached === true)
        .map((e) => [e.instance.siteId, e.sourceSessionId]),
    ).toEqual([
      ["ask#2", "sess-a"],
      ["ask#3", undefined],
      ["ask#4", undefined],
    ]);

    const rerun = engine.worldRead("world#1", "run", NPM_TEST);
    expect(driver.worldReads).toHaveLength(1);
    driver.worldReads[0]?.deferred.resolve({ exitCode: 0, round: "live" });
    await expect(rerun).resolves.toEqual({ exitCode: 0, round: "live" });

    const review3 = engine.ask("ask#5", reviewer, "review-3");
    await flush();
    expect(driver.startAskCount()).toBe(1);
    expect(driver.startAsks[0]?.instance.siteId).toBe("ask#5");
    expect(driver.sessionSeeds[0]).toEqual({ sourceSessionId: "sess-a", messageCount: 6, resolvedModel: "zhipu/glm-5.3" });
    engine.askTurnEnded({ siteId: "ask#5", ordinal: 1 }, "reviewed");
    await expect(review3).resolves.toBe("reviewed");
  });

  it("Resume after crash: only live ask, no close event ⇒ door remains open, table entries hit as usual", async () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({ runId: RUN, caps: { maxConcurrency: 16 }, spentTokens: 0, status: "running", resumedFrom: "run-a" });
    journal.putActor({ runId: RUN, siteId: "actor#2", ordinal: 1, name: "fixer", persona: { name: "fixer" } });
    journal.putNode({
      runId: RUN,
      siteId: "ask#3",
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#2",
      actorOrdinal: 1,
      actorSeq: 0,
      inputHash: inputHash("修好 parser"),
      status: "completed",
      result: "journal-ask#3",
    });
    journal.appendEvent(RUN, {
      type: "node-queued",
      instance: { siteId: "ask#3", ordinal: 1 },
      kind: "ask",
      actor: { siteId: "actor#2", ordinal: 1 },
      actorSeq: 0,
    });

    const { engine, driver } = setup({ journal, importedCache: closingCache() });
    const fixer = engine.createActor("actor#2", "fixer");
    const reviewer = engine.createActor("actor#3", "reviewer");
    await expect(engine.ask("ask#3", fixer, "修好 parser")).resolves.toBe("journal-ask#3");
    await expect(engine.ask("ask#2", reviewer, "review-1")).resolves.toBe("r-review-1");
    await expect(engine.worldRead("world#1", "run", NPM_TEST)).resolves.toEqual({ exitCode: 0, round: 1 });
    expect(driver.startAskCount()).toBe(0);
    expect(driver.worldReads).toHaveLength(0);
  });
});

describe("Import cache — continue running predecessor's in-flight ask (docs/execution-engine.md \"How the engine consumes the cache\")", () => {
  
  const inFlightOf = (instructions: string, messageBoundary: number) => ({
    inputHash: inputHash(instructions),
    messageBoundary,
  });

  const cachedSettles = (driver: FakeDriver) =>
    driver.eventsOfType("node-settled").filter((e) => e.cached === true);

  it("The same ask (hash matches): seed includes the entire in-progress transcript, ask still runs live instead of settling from cache", async () => {
    const cache = cacheOf([
      ["planner", candidate([entry("s0", "r0", 4)], { inFlight: inFlightOf("s1", 12) })],
    ]);
    const { engine, driver, journal } = setup({ importedCache: cache });

    const planner = engine.createActor("actor#1", "planner");
    await expect(engine.ask("ask#1", planner, "s0")).resolves.toBe("r0");

    const p1 = engine.ask("ask#2", planner, "s1");
    await flush();

    expect(driver.startAskCount()).toBe(1);
    expect(driver.startAsks[0]?.instance.siteId).toBe("ask#2");
    expect(cachedSettles(driver)).toHaveLength(1);
    expect(driver.sessionSeeds[0]).toEqual({
      sourceSessionId: "sess-a",
      messageCount: 12,
      resolvedModel: "zhipu/glm-5.3",
    });

    engine.askTurnEnded({ siteId: "ask#2", ordinal: 1 }, "live-1");
    await expect(p1).resolves.toBe("live-1");
    expect(journal.getNode(RUN, "ask#2", 1)?.result).toBe("live-1");
  });

  it("Candidate with zero completed (entries empty + inFlight): common shape when revised during fan-out first round in-flight", async () => {
    const cache = cacheOf([["planner", candidate([], { inFlight: inFlightOf("s0", 6) })]]);
    const { engine, driver } = setup({ importedCache: cache });

    const planner = engine.createActor("actor#1", "planner");
    const p0 = engine.ask("ask#1", planner, "s0");
    await flush();

    expect(driver.startAskCount()).toBe(1);
    expect(cachedSettles(driver)).toHaveLength(0);
    expect(driver.sessionSeeds[0]).toEqual({
      sourceSessionId: "sess-a",
      messageCount: 6,
      resolvedModel: "zhipu/glm-5.3",
    });

    engine.askTurnEnded({ siteId: "ask#1", ordinal: 1 }, "live-0");
    await expect(p0).resolves.toBe("live-0");
  });

  it("Instruction changed (hash mismatch): fall back to legacy behavior—truncate to prefix boundary, no seed if no prefix", async () => {
    const withPrefix = cacheOf([
      ["planner", candidate([entry("s0", "r0", 4)], { inFlight: inFlightOf("旧的第二问", 12) })],
    ]);
    const first = setup({ importedCache: withPrefix });
    const planner = first.engine.createActor("actor#1", "planner");
    await expect(first.engine.ask("ask#1", planner, "s0")).resolves.toBe("r0");
    const p1 = first.engine.ask("ask#2", planner, "改过的第二问");
    await flush();
    expect(first.driver.sessionSeeds[0]).toEqual({
      sourceSessionId: "sess-a",
      messageCount: 4,
      resolvedModel: "zhipu/glm-5.3",
    });
    first.engine.askTurnEnded({ siteId: "ask#2", ordinal: 1 }, "live");
    await expect(p1).resolves.toBe("live");

    const noPrefix = cacheOf([
      ["planner", candidate([], { inFlight: inFlightOf("旧的第一问", 6) })],
    ]);
    const second = setup({ importedCache: noPrefix });
    const fresh = second.engine.createActor("actor#1", "planner");
    const p0 = second.engine.ask("ask#1", fresh, "改过的第一问");
    await flush();
    expect(second.driver.startAskCount()).toBe(1);
    expect(second.driver.sessionSeeds[0]).toBeUndefined();
    second.engine.askTurnEnded({ siteId: "ask#1", ordinal: 1 }, "live");
    await expect(p0).resolves.toBe("live");
  });

  it("Door closed: in-progress transcript is full of predecessor observations of the old workspace, no longer continuing execution—fall back to prefix boundary", async () => {
    const cache = cacheOf([
      ["planner", candidate([entry("s0", "r0", 4)], { inFlight: inFlightOf("s1", 12) })],
      ["fixer", candidate([], { persona: { name: "fixer" } })],
    ]);
    const { engine, driver } = setup({ importedCache: cache });

    const fixer = engine.createActor("actor#2", "fixer");
    const planner = engine.createActor("actor#1", "planner");
    await expect(engine.ask("ask#1", planner, "s0")).resolves.toBe("r0");

    const fix = engine.ask("ask#3", fixer, "修好 parser");
    await flush();
    engine.askMutating({ siteId: "ask#3", ordinal: 1 });
    expect(driver.eventsOfType("import-cache-closed")).toHaveLength(1);

    const p1 = engine.ask("ask#2", planner, "s1");
    await flush();
    const plannerSeed =
      driver.sessionSeeds[driver.sessionCreations.findIndex((ref) => ref.siteId === "actor#1")];
    expect(plannerSeed).toEqual({
      sourceSessionId: "sess-a",
      messageCount: 4,
      resolvedModel: "zhipu/glm-5.3",
    });

    engine.askTurnEnded({ siteId: "ask#2", ordinal: 1 }, "live-1");
    await expect(p1).resolves.toBe("live-1");
    engine.askTurnEnded({ siteId: "ask#3", ordinal: 1 }, "fixed");
    await expect(fix).resolves.toBe("fixed");
  });

  it("Actor diverged earlier: no longer on the same transcript upon reaching in-flight position, does not continue execution even if hash matches", async () => {
    const cache = cacheOf([
      [
        "planner",
        candidate([entry("旧的第一问", "r0", 4), entry("s1", "r1", 9)], {
          inFlight: inFlightOf("s2", 14),
        }),
      ],
    ]);
    const { engine, driver } = setup({ importedCache: cache });

    const planner = engine.createActor("actor#1", "planner");
    const p0 = engine.ask("ask#1", planner, "s0");
    const p1 = engine.ask("ask#2", planner, "s1");
    const p2 = engine.ask("ask#3", planner, "s2");
    await flush();

    expect(driver.sessionSeeds[0]).toBeUndefined();
    engine.askTurnEnded({ siteId: "ask#1", ordinal: 1 }, "live-0");
    await expect(p0).resolves.toBe("live-0");
    await flush();
    engine.askTurnEnded({ siteId: "ask#2", ordinal: 1 }, "live-1");
    await expect(p1).resolves.toBe("live-1");
    await flush();
    engine.askTurnEnded({ siteId: "ask#3", ordinal: 1 }, "live-2");
    await expect(p2).resolves.toBe("live-2");
    expect(driver.startAskCount()).toBe(3);
    expect(cachedSettles(driver)).toHaveLength(0);
  });

  describe("Resume after crash: accurately reconstruct \"was the door open at the time\" based on event order", () => {
    
    function recordedFirstLife(closeBeforeCarry: boolean): InMemoryJournalStore {
      const journal = new InMemoryJournalStore();
      journal.createRun({
        runId: RUN,
        caps: { maxConcurrency: 16 },
        spentTokens: 0,
        status: "running",
        resumedFrom: "run-a",
      });
      journal.putActor({
        runId: RUN,
        siteId: "actor#1",
        ordinal: 1,
        name: "planner",
        persona: { name: "planner" },
      });
      const row = (siteId: string, seq: number, instructions: string): NodeRecord => ({
        runId: RUN,
        siteId,
        ordinal: 1,
        kind: "ask",
        actorSiteId: "actor#1",
        actorOrdinal: 1,
        actorSeq: seq,
        inputHash: inputHash(instructions),
        status: "completed",
        result: `journal-${seq}`,
      });
      journal.putNode({ ...row("ask#1", 0, "s0"), messageBoundary: 4 });
      journal.putNode(row("ask#2", 1, "s1"));
      if (closeBeforeCarry) {
        journal.appendEvent(RUN, {
          type: "import-cache-closed",
          instance: { siteId: "world#1", ordinal: 1 },
          cause: "world-run",
        });
      }
      journal.appendEvent(RUN, {
        type: "node-queued",
        instance: { siteId: "ask#2", ordinal: 1 },
        kind: "ask",
        actor: { siteId: "actor#1", ordinal: 1 },
        actorSeq: 1,
      });
      return journal;
    }

    const carryCache = () =>
      cacheOf([["planner", candidate([entry("s0", "r0", 4)], { inFlight: inFlightOf("s1", 12) })]]);

    it("node-queued earlier than close event ⇒ original run indeed continued execution, resume reconstructs the same seed", async () => {
      const { engine, driver } = setup({
        journal: recordedFirstLife(false),
        importedCache: carryCache(),
      });
      const planner = engine.createActor("actor#1", "planner");
      await expect(engine.ask("ask#1", planner, "s0")).resolves.toBe("journal-0");
      await expect(engine.ask("ask#2", planner, "s1")).resolves.toBe("journal-1");

      const p2 = engine.ask("ask#3", planner, "s2");
      await flush();
      expect(driver.startAskCount()).toBe(1);
      expect(driver.sessionSeeds[0]).toEqual({
        sourceSessionId: "sess-a",
        messageCount: 12,
        resolvedModel: "zhipu/glm-5.3",
      });
      engine.askTurnEnded({ siteId: "ask#3", ordinal: 1 }, "live-2");
      await expect(p2).resolves.toBe("live-2");
    });

    it("Close event earlier than node-queued ⇒ original run did not continue execution, resume must fall back to prefix boundary (copying extra would contaminate the transcript)", async () => {
      const { engine, driver } = setup({
        journal: recordedFirstLife(true),
        importedCache: carryCache(),
      });
      const planner = engine.createActor("actor#1", "planner");
      await expect(engine.ask("ask#1", planner, "s0")).resolves.toBe("journal-0");
      await expect(engine.ask("ask#2", planner, "s1")).resolves.toBe("journal-1");

      const p2 = engine.ask("ask#3", planner, "s2");
      await flush();
      expect(driver.sessionSeeds[0]).toEqual({
        sourceSessionId: "sess-a",
        messageCount: 4,
        resolvedModel: "zhipu/glm-5.3",
      });
      engine.askTurnEnded({ siteId: "ask#3", ordinal: 1 }, "live-2");
      await expect(p2).resolves.toBe("live-2");
    });
  });
});

describe("Import cache — asks whose transcript precedes this dispatch do not record worldToolCalls", () => {
  const TOUCHED = { tokens: 20, toolCalls: 4, turns: 2, worldToolCalls: 0 } as const;

  it("Continued ask: settled stats strip worldToolCalls (counter only counted the turns in this dispatch)", async () => {
    const cache = cacheOf([
      ["planner", candidate([], { inFlight: { inputHash: inputHash("s0"), messageBoundary: 6 } })],
    ]);
    const { engine, journal } = setup({ importedCache: cache });
    const planner = engine.createActor("actor#1", "planner");
    const p0 = engine.ask("ask#1", planner, "s0");
    await flush();

    engine.askStats({ siteId: "ask#1", ordinal: 1 }, { ...TOUCHED });
    engine.askTurnEnded({ siteId: "ask#1", ordinal: 1 }, "live-0");
    await expect(p0).resolves.toBe("live-0");

    expect(journal.getNode(RUN, "ask#1", 1)?.stats).toEqual({ tokens: 20, toolCalls: 4, turns: 2 });
  });

  it("Continued ask: stats backfill arriving after settlement also strips worldToolCalls", async () => {
    const cache = cacheOf([
      ["planner", candidate([], { inFlight: { inputHash: inputHash("s0"), messageBoundary: 6 } })],
    ]);
    const { engine, journal } = setup({ importedCache: cache });
    const planner = engine.createActor("actor#1", "planner");
    const p0 = engine.ask("ask#1", planner, "s0");
    await flush();

    engine.askTurnEnded({ siteId: "ask#1", ordinal: 1 }, "live-0");
    await expect(p0).resolves.toBe("live-0");
    engine.askStats({ siteId: "ask#1", ordinal: 1 }, { ...TOUCHED });

    expect(journal.getNode(RUN, "ask#1", 1)?.stats).toEqual({ tokens: 20, toolCalls: 4, turns: 2 });
  });

  it("Running rows redispatched on resume: transcript already has tool calls from the previous round, worldToolCalls also not recorded", async () => {
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
      name: "planner",
      persona: { name: "planner" },
    });
    journal.putNode({
      runId: RUN,
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorSeq: 0,
      inputHash: inputHash("s0"),
      status: "running",
    });

    const { engine } = setup({ journal });
    const planner = engine.createActor("actor#1", "planner");
    const p0 = engine.ask("ask#1", planner, "s0");
    await flush();

    engine.askStats({ siteId: "ask#1", ordinal: 1 }, { ...TOUCHED });
    engine.askTurnEnded({ siteId: "ask#1", ordinal: 1 }, "live-0");
    await expect(p0).resolves.toBe("live-0");
    expect(journal.getNode(RUN, "ask#1", 1)?.stats).toEqual({ tokens: 20, toolCalls: 4, turns: 2 });
  });

  it("寻常的 live ask：worldToolCalls 照记（纯度判据不能被这条规则抹掉）", async () => {
    const { engine, journal } = setup();
    const planner = engine.createActor("actor#1", "planner");
    const p0 = engine.ask("ask#1", planner, "s0");
    await flush();

    engine.askStats({ siteId: "ask#1", ordinal: 1 }, { ...TOUCHED });
    engine.askTurnEnded({ siteId: "ask#1", ordinal: 1 }, "live-0");
    await expect(p0).resolves.toBe("live-0");
    expect(journal.getNode(RUN, "ask#1", 1)?.stats).toEqual({ ...TOUCHED });
  });
});

describe("Import cache — usage accumulates along lineage (docs/execution-engine.md \"Usage across the lineage\")", () => {
  it("Hit adds no tokens: predecessor's tally is already in inherited value, entry stats are only copied to node row; live divergence then accumulates on top", async () => {
    const cache = cacheOf([
      [
        "planner",
        candidate([
          entry("step 1", "r1", 4, { tokens: 100, toolCalls: 0, turns: 1 }),
          entry("step 2", "r2", 9, { tokens: 100, toolCalls: 0, turns: 1 }),
        ]),
      ],
    ]);
    const { engine, driver, journal } = setup({ importedCache: cache, inheritedTokens: 500 });
    const planner = engine.createActor("actor#1", "planner");
    await expect(engine.ask("ask#1", planner, "step 1")).resolves.toBe("r1");
    expect(journal.getRun(RUN)?.spentTokens).toBe(500);
    const hitStats = { tokens: 100, toolCalls: 0, turns: 1 };
    expect(journal.getNode(RUN, "ask#1", 1)?.stats).toEqual(hitStats);
    expect(driver.events.filter((event) => event.type === "usage-updated")).toEqual([
      { type: "usage-updated", spentTokens: 500 },
    ]);

    void engine.ask("ask#2", planner, "step 2, revised").catch(() => {});
    await flush();
    expect(driver.startAskCount()).toBe(1);
    engine.askStats({ siteId: "ask#2", ordinal: 1 }, { tokens: 30, toolCalls: 0, turns: 1 });
    expect(journal.getRun(RUN)?.spentTokens).toBe(530);
    expect(driver.events.at(-1)).toEqual({ type: "usage-updated", spentTokens: 530 });
    engine.stop("user");
  });
});
