

import { describe, expect, it, vi } from "vitest";
import { createTestAgentRuntime } from "./helpers/test-agent-runtime.js";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemorySessionEventStore, createSqliteSessionStore } from "@origin-ai/cf-adapters/storage";
import {
  SUBMIT_RESULT_TOOL_NAME,
  type ModelRequest,
  type SessionId,
  type SessionStorePort,
} from "@origin-ai/cf-contracts";
import { AgentRuntime } from "@origin-ai/cf-core";
import {
  inputHash,
  InMemoryJournalStore,
  refToString,
  type ActorRef,
  type ActorSessionSeed,
  type WorkflowReportSink,
} from "@origin-ai/cf-dynamic-workflow";
import { workflowActorToolPolicy } from "../src/app/workflow-actor-tools.js";
import type { ActorTranscriptStore } from "../src/app/workflow-actor-transcript.js";
import { createWorkflowEscalationRegistry } from "../src/app/workflow-escalation-registry.js";
import {
  createAgentRuntimeWorkflowDriver,
  mintActorSessionId,
} from "../src/app/workflow-driver.js";
import {
  fakeFileSystemPort,
  runDriverScript,
  unsupportedExecutionPort,
} from "./workflow-driver.helpers.js";

const RUN = "run";

describe("workflow driver — accept path", () => {
  it("bridges a valid submit through the real runtime and returns the artifact", async () => {
    const script = [
      "interface Summary { title: string; points: string[]; }",
      'const worker = agent("worker", "You summarize repos.");',
      'const s = await worker.ask<Summary>("Summarize the repo");',
      "log(`title: ${s.title}`);",
      "return s;",
    ].join("\n");

    const artifact = { title: "The Repo", points: ["a", "b"] };
    const { settlement, journal, events, modelCalls } = await runDriverScript(script, {
      caps: { maxConcurrency: 16 },
      actorScripts: {
        "actor#1@1": [{ kind: "submit", result: artifact }],
      },
    });

    expect(settlement).toEqual({ status: "completed", artifact });

    const node = journal.getNode(RUN, "ask#1", 1);
    expect(node?.status).toBe("completed");
    expect(node?.result).toEqual(artifact);
    expect(node?.actorSeq).toBe(0);
    expect(node?.inputHash).toBe(inputHash("Summarize the repo"));
    expect(node?.actorSiteId).toBe("actor#1");

    expect(node?.stats?.tokens ?? 0).toBeGreaterThan(0);
    expect(node?.stats?.turns).toBeGreaterThanOrEqual(1);

    const usageEvents = events.filter((e) => e.type === "usage-updated");
    const lastUsage = usageEvents.at(-1);
    expect(lastUsage?.type === "usage-updated" && lastUsage.spentTokens).toBeGreaterThan(0);

    expect(modelCalls["actor#1@1"]?.calls).toBe(1);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("run-started");
    expect(types).toContain("actor-created");
    expect(types).toContain("node-dispatched");
    const settled = events.filter((e) => e.type === "node-settled");
    expect(settled.at(-1)).toMatchObject({ outcome: "ok" });
    expect(types.at(-1)).toBe("run-settled");
  });
});

const TYPED_ASK_SCRIPT = [
  "interface Summary { title: string; points: string[]; }",
  'const worker = agent("worker", "You summarize repos.");',
  'const s = await worker.ask<Summary>("Summarize the repo");',
  "return s;",
].join("\n");

describe("workflow driver — in-session repair (reject)", () => {
  it("rejects an invalid submit, retries within the same turn, then accepts", async () => {
    const valid = { title: "Repo", points: ["x"] };
    const { settlement, journal, events, modelCalls } = await runDriverScript(TYPED_ASK_SCRIPT, {
      actorScripts: {
        "actor#1@1": [
          { kind: "submit", result: { title: 42 } },
          { kind: "submit", result: valid },
        ],
      },
    });

    expect(settlement).toEqual({ status: "completed", artifact: valid });
    expect(modelCalls["actor#1@1"]?.calls).toBe(2);
    const repairing = events.filter((e) => e.type === "node-repairing");
    expect(repairing.length).toBe(1);
    expect(journal.getNode(RUN, "ask#1", 1)?.status).toBe("completed");
  });

  it("fails the ask with ValidationFailed after the repair attempts are exhausted", async () => {
    const invalid = { kind: "submit" as const, result: { title: 1 } };
    const { settlement, journal, events } = await runDriverScript(TYPED_ASK_SCRIPT, {
      actorScripts: { "actor#1@1": [invalid, invalid, invalid, invalid] },
    });

    expect(settlement.status).toBe("errored");
    const node = journal.getNode(RUN, "ask#1", 1);
    expect(node?.status).toBe("failed");
    expect(node?.error?.code).toBe("ValidationFailed");
    expect(events.filter((e) => e.type === "node-repairing").length).toBe(3);
  });
});

describe("workflow driver — nudge", () => {
  it("nudges a turn that ended without a submit, then accepts on the fresh turn", async () => {
    const valid = { title: "Repo", points: ["x"] };
    const { settlement, events, modelCalls } = await runDriverScript(TYPED_ASK_SCRIPT, {
      actorScripts: {
        "actor#1@1": [
          { kind: "text", text: "Here is the summary." },
          { kind: "submit", result: valid },
        ],
      },
    });

    expect(settlement).toEqual({ status: "completed", artifact: valid });
    expect(modelCalls["actor#1@1"]?.calls).toBe(2);
    expect(events.filter((e) => e.type === "node-nudged").length).toBe(1);
  });

  it("fails with ResultNotSubmitted when nudge is exhausted", async () => {
    const { settlement, journal, events } = await runDriverScript(TYPED_ASK_SCRIPT, {
      actorScripts: {
        "actor#1@1": [
          { kind: "text", text: "no submit 1" },
          { kind: "text", text: "no submit 2" },
        ],
      },
    });

    expect(settlement.status).toBe("errored");
    const node = journal.getNode(RUN, "ask#1", 1);
    expect(node?.status).toBe("failed");
    expect(node?.error?.code).toBe("ResultNotSubmitted");
    expect(events.filter((e) => e.type === "node-nudged").length).toBe(1);
  });
});

describe("workflow driver — untyped ask", () => {
  it("settles an untyped ask from the turn's final text (no submit_result)", async () => {
    const script = [
      'const worker = agent("worker");',
      'const answer = await worker.ask("What is 2 + 2?");',
      "return answer;",
    ].join("\n");

    const { settlement, journal } = await runDriverScript(script, {
      actorScripts: { "actor#1@1": [{ kind: "text", text: "The answer is 4." }] },
    });

    expect(settlement).toEqual({ status: "completed", artifact: "The answer is 4." });
    expect(journal.getNode(RUN, "ask#1", 1)?.result).toBe("The answer is 4.");
  });

  it("guards submit_result called on an untyped ask without hanging", async () => {
    const script = [
      'const worker = agent("worker");',
      'const answer = await worker.ask("Say hello.");',
      "return answer;",
    ].join("\n");

    const { settlement, modelCalls } = await runDriverScript(script, {
      actorScripts: {
        "actor#1@1": [
          { kind: "submit", result: { foo: "bar" } },
          { kind: "text", text: "hello there" },
        ],
      },
    });

    expect(settlement).toEqual({ status: "completed", artifact: "hello there" });
    expect(modelCalls["actor#1@1"]?.calls).toBe(2);
  });
});

describe("workflow driver — lenient stringified submit", () => {
  it("accepts a submit whose result is a stringified JSON object and journals the parsed object", async () => {
    const artifact = { title: "The Repo", points: ["a", "b"] };
    const { settlement, journal, modelCalls } = await runDriverScript(TYPED_ASK_SCRIPT, {
      actorScripts: {
        "actor#1@1": [{ kind: "submit", result: JSON.stringify(artifact) }],
      },
    });

    expect(settlement).toEqual({ status: "completed", artifact });
    expect(modelCalls["actor#1@1"]?.calls).toBe(1);
    const node = journal.getNode(RUN, "ask#1", 1);
    expect(node?.status).toBe("completed");
    expect(node?.result).toEqual(artifact);
  });
});

describe("workflow driver — actor tool surface", () => {
  const PROFILE_SCRIPT = (persona: string) =>
    [
      "interface Verdict { approved: boolean; }",
      `const judge = ${persona};`,
      'const v = await judge.ask<Verdict>("Approve it?");',
      "return v;",
    ].join("\n");

  
  async function toolNamesForPersona(persona: string): Promise<string[]> {
    const { settlement, modelCalls } = await runDriverScript(PROFILE_SCRIPT(persona), {
      actorScripts: { "actor#1@1": [{ kind: "submit", result: { approved: true } }] },
    });
    expect(settlement).toEqual({ status: "completed", artifact: { approved: true } });
    const names = modelCalls["actor#1@1"]?.toolNames[0];
    return names ?? [];
  }

  it("keeps the full working set for every actor, minus plan-mode and meta tools", async () => {
    const names = await toolNamesForPersona('agent("worker", "You do work.")');
    for (const expected of ["Bash", "Edit", "Write", "AskUserQuestion", SUBMIT_RESULT_TOOL_NAME]) {
      expect(names).toContain(expected);
    }
    for (const forbidden of [
      "EnterPlanMode",
      "ExitPlanMode",
      "CreateWorkflow",
      "ReadSessionContext",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe("workflow driver — resume by replay", () => {
  it("short-circuits journaled nodes on resume with zero actor dispatches", async () => {
    const script = [
      "interface Verdict { approved: boolean; }",
      'const paths = await files.glob("src/**/*.ts");',
      'const v = await agent("reviewer").ask<Verdict>(`Review ${paths.length} files`);',
      "return { count: paths.length, approved: v.approved };",
    ].join("\n");

    const journal = new InMemoryJournalStore();
    const files = { glob: ["src/a.ts", "src/b.ts"] };
    const artifact = { count: 2, approved: true };

    const first = await runDriverScript(script, {
      journal,
      files,
      actorScripts: { "actor#1@1": [{ kind: "submit", result: { approved: true } }] },
    });
    expect(first.settlement).toEqual({ status: "completed", artifact });
    expect(first.modelCalls["actor#1@1"]?.calls).toBe(1);

    const resumed = await runDriverScript(script, {
      journal,
      files,
      actorScripts: {},
    });
    expect(resumed.settlement).toEqual({ status: "completed", artifact });
    expect(Object.keys(resumed.modelCalls)).toHaveLength(0);
    const cachedSettles = resumed.events.filter(
      (e) => e.type === "node-settled" && e.cached === true,
    );
    expect(cachedSettles.length).toBeGreaterThan(0);
  });
});

describe("workflow driver — world reads", () => {
  it("executes glob/read via the fs port and threads results into a typed ask", async () => {
    const script = [
      "interface Verdict { approved: boolean; }",
      'const paths = await files.glob("src/**/*.ts");',
      'const first = paths[0] ?? "none";',
      "const text = await files.read(first);",
      'const v = await agent("reviewer").ask<Verdict>(`Review ${first} (${text.length} bytes)`);',
      "return { count: paths.length, first, approved: v.approved };",
    ].join("\n");

    const { settlement, journal } = await runDriverScript(script, {
      files: { glob: ["src/a.ts", "src/b.ts"], read: "export const x = 1;\n" },
      actorScripts: { "actor#1@1": [{ kind: "submit", result: { approved: true } }] },
    });

    expect(settlement).toEqual({
      status: "completed",
      artifact: { count: 2, first: "src/a.ts", approved: true },
    });
    const glob = journal.getNode(RUN, "world-read#1", 1);
    expect(glob?.kind).toBe("world-read");
    expect(glob?.result).toEqual(["src/a.ts", "src/b.ts"]);
    const read = journal.getNode(RUN, "world-read#2", 1);
    expect(read?.result).toBe("export const x = 1;\n");
  });
});

describe("workflow driver — actor session ids", () => {
  
  async function sessionIdsFor(runId: string): Promise<string[]> {
    const ids: string[] = [];
    await runDriverScript(['const a = await agent("w").ask("go");', "return a;"].join("\n"), {
      actorScripts: {},
      runId,
      runtimeFactory: ({ sessionId }) => {
        ids.push(sessionId);
        return {
          executeTurn: async () => ({ response: "ok", events: [], usage: undefined }),
        } as never;
      },
    });
    return ids;
  }

  it("会话 id 含 runId 且不含 # @ /", async () => {
    const ids = await sessionIdsFor("dwfrun-plain");

    expect(ids).toHaveLength(1);
    expect(ids[0]).toContain("dwfrun-plain");
    expect(ids[0]).not.toMatch(/[#@/]/);
  });

  it("下划线转义使 sanitize 可逆到不碰撞：a_b 与 a#b 不折叠成同一个 id", async () => {
    const [underscore] = await sessionIdsFor("a_b");
    const [hash] = await sessionIdsFor("a#b");

    expect(underscore).not.toBe(hash);
    expect(underscore).toContain("a__b");
    expect(hash).toContain("a_b");
  });

  it("对抗性对子逐对不碰撞（actor#1 vs actor_1 等）", async () => {
    const pairs: readonly [string, string][] = [
      ["actor#1", "actor_1"],
      ["actor#1@2", "actor_1@2"],
      ["ask#3/2", "ask_3_2"],
    ];

    for (const [left, right] of pairs) {
      const [leftId] = await sessionIdsFor(left);
      const [rightId] = await sessionIdsFor(right);
      expect(leftId, `${left} vs ${right}`).not.toBe(rightId);
      expect(leftId).not.toMatch(/[#@/]/);
      expect(rightId).not.toMatch(/[#@/]/);
    }
  });
});

describe("workflow driver — resume 会话身份互证", () => {
  const NOOP_SINK: WorkflowReportSink = {
    askSubmitAttempted: () => {},
    askTurnEnded: () => {},
    askProgress: () => {},
    askStats: () => {},
    askFailed: () => {},
    askWaiting: () => {},
    askExecuting: () => {},
    askMutating: () => {},
    concurrencyChanged: () => {},
    stopRun: () => {},
    runStalled: () => {},
  };

  function driverWith(journal: InMemoryJournalStore, onFactory?: () => void) {
    const makeDriver = createAgentRuntimeWorkflowDriver({
      journal,
      emit: () => {},
      escalationRegistry: createWorkflowEscalationRegistry(),
      fileSystemPort: fakeFileSystemPort({}),
      cwd: process.cwd(),
      runId: RUN,
      runtimeFactory: () => {
        onFactory?.();
        return {
          executeTurn: async () => ({ response: "ok", events: [], usage: undefined }),
        } as never;
      },
    });
    return makeDriver(NOOP_SINK);
  }

  it("journal 记录的 sessionId 与铸造结果不一致时大声失败，且不构造 runtime", async () => {
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
      sessionId: "sess_drifted-scheme",
    });

    let factoryCalls = 0;
    const driver = driverWith(journal, () => factoryCalls++);
    await expect(
      driver.createActorSession({ siteId: "actor#1", ordinal: 1 }, {}),
    ).rejects.toMatchObject({
      code: "DriverError",
      mismatch: {
        expected: "sess_drifted-scheme",
        got: mintActorSessionId(RUN, { siteId: "actor#1", ordinal: 1 }),
      },
    });
    expect(factoryCalls).toBe(0);
  });

  it("journal 记录与铸造结果一致时正常重挂（同一个会话 id）", async () => {
    const minted = mintActorSessionId(RUN, { siteId: "actor#1", ordinal: 1 });
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    journal.putActor({ runId: RUN, siteId: "actor#1", ordinal: 1, sessionId: minted });

    let factoryCalls = 0;
    const driver = driverWith(journal, () => factoryCalls++);
    await expect(driver.createActorSession({ siteId: "actor#1", ordinal: 1 }, {})).resolves.toEqual(
      {
        id: minted,
      },
    );
    expect(factoryCalls).toBe(1);
  });

  it("journal 无记录（全新 actor）时不做互证，正常建会话", async () => {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });

    const driver = driverWith(journal);
    await expect(driver.createActorSession({ siteId: "actor#1", ordinal: 1 }, {})).resolves.toEqual(
      {
        id: mintActorSessionId(RUN, { siteId: "actor#1", ordinal: 1 }),
      },
    );
  });
});

// ————————————————————————————————————————————————————————————————
//
// ————————————————————————————————————————————————————————————————

async function withSessionStore(run: (store: SessionStorePort) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "cf-dwf-transcript-"));
  const store = await createSqliteSessionStore({ dbPath: join(root, "session.sqlite") });
  try {
    await run(store as unknown as SessionStorePort);
  } finally {
    (store as unknown as { close(): void }).close();
    await rm(root, { force: true, recursive: true });
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor 超时");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const TWO_ASK_SCRIPT = [
  "interface A { text: string }",
  'const w = agent("worker", "You work.");',
  'const a = await w.ask<A>("first question");',
  'const b = await w.ask<A>("second question");',
  "return `${a.text}/${b.text}`;",
].join("\n");

const ACTOR_ONE: ActorRef = { siteId: "actor#1", ordinal: 1 };

describe("workflow driver — ask 边界记账", () => {
  it("Record the actor session\'s message count after each ask settles; the second ask has a larger boundary", async () => {
    await withSessionStore(async (store) => {
      const runId = "dwfrun-boundary";
      const { settlement, journal } = await runDriverScript(TWO_ASK_SCRIPT, {
        runId,
        sessionStore: store,
        actorScripts: {
          "actor#1@1": [
            { kind: "submit", result: { text: "one" } },
            { kind: "submit", result: { text: "two" } },
          ],
        },
      });
      expect(settlement).toEqual({ status: "completed", artifact: "one/two" });

      const first = journal.getNode(runId, "ask#1", 1);
      const second = journal.getNode(runId, "ask#2", 1);
      const persisted = await store.messages({
        sessionID: mintActorSessionId(runId, ACTOR_ONE),
      });
      expect(second?.messageBoundary).toBe(persisted.length);
      expect(first?.messageBoundary).toBeGreaterThan(0);
      expect(second?.messageBoundary).toBeGreaterThan(first?.messageBoundary ?? 0);

      expect(first).toMatchObject({
        status: "completed",
        actorSeq: 0,
        inputHash: inputHash("first question"),
        result: { text: "one" },
      });
      expect(first?.stats?.tokens).toBeGreaterThan(0);
      expect(second?.actorSeq).toBe(1);
      expect(second?.stats?.tokens).toBeGreaterThan(0);
    });
  }, 30_000);

  it("多 actor 各数各的会话（边界不串台）", async () => {
    await withSessionStore(async (store) => {
      const runId = "dwfrun-boundary-multi";
      const script = [
        "interface A { text: string }",
        'const a = agent("a", "You are A.");',
        'const b = agent("b", "You are B.");',
        'const one = await a.ask<A>("a-first");',
        'const other = await b.ask<A>("b-only");',
        'const two = await a.ask<A>("a-second");',
        "return `${one.text}${other.text}${two.text}`;",
      ].join("\n");
      const answer: { kind: "submit"; result: { text: string } } = {
        kind: "submit",
        result: { text: "x" },
      };
      const { settlement, journal } = await runDriverScript(script, {
        runId,
        sessionStore: store,
        actorScripts: { "actor#1@1": [answer, answer], "actor#2@1": [answer] },
      });
      expect(settlement.status).toBe("completed");

      const aFirst = journal.getNode(runId, "ask#1", 1)?.messageBoundary;
      const bOnly = journal.getNode(runId, "ask#2", 1)?.messageBoundary;
      const aSecond = journal.getNode(runId, "ask#3", 1)?.messageBoundary;
      expect(bOnly).toBe(aFirst);
      expect(aSecond).toBe((aFirst ?? 0) * 2);
      const bPersisted = await store.messages({
        sessionID: mintActorSessionId(runId, { siteId: "actor#2", ordinal: 1 }),
      });
      expect(bOnly).toBe(bPersisted.length);
    });
  }, 30_000);

  it("无转录存取面时不写边界（既有装配原样不变）", async () => {
    const runId = "dwfrun-no-store";
    const { journal } = await runDriverScript(TWO_ASK_SCRIPT, {
      runId,
      actorScripts: {
        "actor#1@1": [
          { kind: "submit", result: { text: "one" } },
          { kind: "submit", result: { text: "two" } },
        ],
      },
    });
    expect(journal.getNode(runId, "ask#1", 1)?.messageBoundary).toBeUndefined();
    expect(journal.getNode(runId, "ask#2", 1)?.status).toBe("completed");
  }, 30_000);
});

describe("workflow driver — 转录截断（会话种子）", () => {
  const NOOP_SINK: WorkflowReportSink = {
    askSubmitAttempted: () => {},
    askTurnEnded: () => {},
    askProgress: () => {},
    askStats: () => {},
    askFailed: () => {},
    askWaiting: () => {},
    askExecuting: () => {},
    askMutating: () => {},
    concurrencyChanged: () => {},
    stopRun: () => {},
    runStalled: () => {},
  };

  
  async function recordSourceRun(
    store: SessionStorePort,
    runId: string,
  ): Promise<{ boundaries: number[]; sessionId: SessionId }> {
    const { settlement, journal } = await runDriverScript(TWO_ASK_SCRIPT, {
      runId,
      sessionStore: store,
      actorScripts: {
        "actor#1@1": [
          { kind: "submit", result: { text: "one" } },
          { kind: "submit", result: { text: "two" } },
        ],
      },
    });
    expect(settlement.status).toBe("completed");
    return {
      boundaries: [
        journal.getNode(runId, "ask#1", 1)?.messageBoundary ?? 0,
        journal.getNode(runId, "ask#2", 1)?.messageBoundary ?? 0,
      ],
      sessionId: mintActorSessionId(runId, ACTOR_ONE),
    };
  }

  
  function countingTranscriptStore(store: SessionStorePort): {
    store: ActorTranscriptStore;
    writes: { messages: number; parts: number };
  } {
    const writes = { messages: 0, parts: 0 };
    return {
      writes,
      store: {
        messages: (input) => store.messages(input),
        saveMessage: async (message) => {
          writes.messages++;
          await store.saveMessage(message);
        },
        savePart: async (part) => {
          writes.parts++;
          await store.savePart(part);
        },
      },
    };
  }

  
  function amendDriver(input: {
    journal: InMemoryJournalStore;
    runId: string;
    store: SessionStorePort;
    transcriptStore?: ActorTranscriptStore;
  }) {
    const seeds: (ActorSessionSeed | undefined)[] = [];
    const requests: ModelRequest[] = [];
    const fileSystemPort = fakeFileSystemPort({});
    const driver = createAgentRuntimeWorkflowDriver({
      journal: input.journal,
      emit: () => {},
      escalationRegistry: createWorkflowEscalationRegistry(),
      executionPort: unsupportedExecutionPort(),
      fileSystemPort,
      cwd: process.cwd(),
      runId: input.runId,
      actorTranscriptStore: input.transcriptStore ?? input.store,
      runtimeFactory: async ({ actor, persona, seed, sessionId, submitPort }) => {
        seeds.push(seed);
        const runtime = createTestAgentRuntime(
          sessionId,
          {
            systemPrompt: persona.system ?? "You are a workflow actor.",
            mode: "yolo",
            taskType: "workflow_child",
            subagents: { enabled: false },
            ...workflowActorToolPolicy(persona),
          },
          {
            eventStore: createInMemorySessionEventStore(),
            modelAdapter: {
              async generateText(request: ModelRequest) {
                requests.push(request);
                return {
                  finishReason: "stop",
                  model: "scripted",
                  providerMetadata: undefined,
                  text: "ok",
                  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                };
              },
            } as never,
            workflowSubmitPort: submitPort,
            fileSystemPort,
            sessionStore: input.store,
          },
        );
        await runtime.ensureSessionPersistedForExternalActivity(
          `workflow actor ${refToString(actor)}`,
        );
        return runtime;
      },
    })(NOOP_SINK);
    return { driver, requests, seeds };
  }

  function journalFor(runId: string): InMemoryJournalStore {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    return journal;
  }

  it("按边界复制源会话前缀进新铸会话，且前驱转录一字不动", async () => {
    await withSessionStore(async (store) => {
      const source = await recordSourceRun(store, "dwfrun-src");
      const sourceMessages = await store.messages({ sessionID: source.sessionId });
      const amendRunId = "dwfrun-amend";
      const { driver, seeds } = amendDriver({
        journal: journalFor(amendRunId),
        runId: amendRunId,
        store,
      });

      const ref = await driver.createActorSession(
        ACTOR_ONE,
        { name: "worker" },
        {
          sourceSessionId: source.sessionId,
          messageCount: source.boundaries[0]!,
          resolvedModel: "anthropic/some-model",
        },
      );

      expect(ref.id).toBe(mintActorSessionId(amendRunId, ACTOR_ONE));
      expect(ref.id).not.toBe(source.sessionId);

      const copied = await store.messages({ sessionID: ref.id as SessionId });
      expect(copied).toHaveLength(source.boundaries[0]!);
      expect(copied.map((m) => m.info.role)).toEqual(
        sourceMessages.slice(0, source.boundaries[0]!).map((m) => m.info.role),
      );
      for (const [index, message] of copied.entries()) {
        expect(message.info.id).not.toBe(sourceMessages[index]!.info.id);
        expect(message.info.sessionID).toBe(ref.id);
        for (const part of message.parts) expect(part.sessionID).toBe(ref.id);
      }
      const sourceAfter = await store.messages({ sessionID: source.sessionId });
      expect(sourceAfter.map((m) => m.info.id)).toEqual(sourceMessages.map((m) => m.info.id));

      expect(seeds).toEqual([
        {
          sourceSessionId: source.sessionId,
          messageCount: source.boundaries[0]!,
          resolvedModel: "anthropic/some-model",
        },
      ]);
    });
  }, 40_000);

  it("复制来的转录进入 runtime 上下文：分歧后的第一次模型请求带着它", async () => {
    await withSessionStore(async (store) => {
      const source = await recordSourceRun(store, "dwfrun-src2");
      const amendRunId = "dwfrun-amend2";
      const { driver, requests } = amendDriver({
        journal: journalFor(amendRunId),
        runId: amendRunId,
        store,
      });

      const ref = await driver.createActorSession(
        ACTOR_ONE,
        { name: "worker" },
        {
          sourceSessionId: source.sessionId,
          messageCount: source.boundaries[0]!,
        },
      );

      driver.startAsk(
        ref,
        { siteId: "ask#1", ordinal: 1 },
        {
          instructions: "continue from where we left off",
          typed: false,
        },
      );
      await waitFor(() => requests.length > 0);

      const conversation = JSON.stringify(requests[0]?.messages ?? []);
      expect(conversation).toContain("first question");
      expect(conversation).toContain("continue from where we left off");
      expect(conversation).not.toContain("second question");
    });
  }, 40_000);

  it("幂等：目标会话已有内容时不再复制（崩溃后重挂同一个会话 id）", async () => {
    await withSessionStore(async (store) => {
      const source = await recordSourceRun(store, "dwfrun-src3");
      const amendRunId = "dwfrun-amend3";
      const journal = journalFor(amendRunId);
      const seed: ActorSessionSeed = {
        sourceSessionId: source.sessionId,
        messageCount: source.boundaries[0]!,
      };

      const first = amendDriver({ journal, runId: amendRunId, store });
      const ref = await first.driver.createActorSession(ACTOR_ONE, { name: "worker" }, seed);
      const afterFirst = await store.messages({ sessionID: ref.id as SessionId });
      expect(afterFirst).toHaveLength(seed.messageCount);

      journal.putActor({ ...ACTOR_ONE, runId: amendRunId, sessionId: ref.id });
      const counting = countingTranscriptStore(store);
      const second = amendDriver({
        journal,
        runId: amendRunId,
        store,
        transcriptStore: counting.store,
      });
      await second.driver.createActorSession(ACTOR_ONE, { name: "worker" }, seed);

      expect(counting.writes).toEqual({ messages: 0, parts: 0 });
      const afterSecond = await store.messages({ sessionID: ref.id as SessionId });
      expect(afterSecond.map((m) => m.info.id)).toEqual(afterFirst.map((m) => m.info.id));
    });
  }, 40_000);

  it("源会话不存在或短于边界 → 结构化大声失败", async () => {
    await withSessionStore(async (store) => {
      const source = await recordSourceRun(store, "dwfrun-src4");
      const amendRunId = "dwfrun-amend4";

      const missing = amendDriver({ journal: journalFor(amendRunId), runId: amendRunId, store });
      await expect(
        missing.driver.createActorSession(
          ACTOR_ONE,
          { name: "worker" },
          {
            sourceSessionId: "sess_never-existed",
            messageCount: 2,
          },
        ),
      ).rejects.toMatchObject({ code: "DriverError", mismatch: { expected: "2", got: "0" } });

      const short = amendDriver({
        journal: journalFor("dwfrun-amend4b"),
        runId: "dwfrun-amend4b",
        store,
      });
      const tooFar = source.boundaries[1]! + 1;
      await expect(
        short.driver.createActorSession(
          ACTOR_ONE,
          { name: "worker" },
          {
            sourceSessionId: source.sessionId,
            messageCount: tooFar,
          },
        ),
      ).rejects.toMatchObject({
        code: "DriverError",
        mismatch: { expected: String(tooFar), got: String(source.boundaries[1]) },
      });
    });
  }, 40_000);

  it("No seed → brand new empty session (byte-for-byte today\'s behavior)", async () => {
    await withSessionStore(async (store) => {
      await recordSourceRun(store, "dwfrun-src5");
      const amendRunId = "dwfrun-fresh";
      const { driver, seeds } = amendDriver({
        journal: journalFor(amendRunId),
        runId: amendRunId,
        store,
      });

      const ref = await driver.createActorSession(ACTOR_ONE, { name: "worker" });

      expect(seeds).toEqual([undefined]);
      expect(await store.messages({ sessionID: ref.id as SessionId })).toHaveLength(0);
    });
  }, 40_000);
});

//
describe("workflow driver — quality epilogue on every ask", () => {
  const STANDARD = "Standard for this result:";

  it("typed ask: instructions, then the standard, then the schema epilogue", async () => {
    const valid = { title: "Repo", points: ["x"] };
    const { modelCalls } = await runDriverScript(TYPED_ASK_SCRIPT, {
      actorScripts: { "actor#1@1": [{ kind: "submit", result: valid }] },
    });
    const prompt = modelCalls["actor#1@1"]?.prompts[0] ?? "";
    const instructions = prompt.indexOf("Summarize the repo");
    const standard = prompt.indexOf(STANDARD);
    const schema = prompt.indexOf("call the `submit_result` tool to submit your final result");
    expect(instructions).toBeGreaterThanOrEqual(0);
    expect(instructions).toBeLessThan(standard);
    expect(standard).toBeLessThan(schema);
    expect(prompt).toContain("A check counts as passed only if you ran it during this ask.");
    expect(prompt).toContain("Run the check the ask names, at the scale it names.");
    expect(prompt).toContain("call `escalate` instead of inventing a value");
    expect(prompt).not.toContain("`evidence` field");
    expect(prompt).not.toContain("Rate `confidence`");
  });

  it("untyped ask: instructions then the standard, no schema epilogue", async () => {
    const script = [
      'const worker = agent("worker");',
      'const answer = await worker.ask("What is 2 + 2?");',
      "return answer;",
    ].join("\n");
    const { modelCalls, settlement } = await runDriverScript(script, {
      actorScripts: { "actor#1@1": [{ kind: "text", text: "4" }] },
    });
    expect(settlement.status).toBe("completed");
    const prompt = modelCalls["actor#1@1"]?.prompts[0] ?? "";
    expect(prompt.indexOf("What is 2 + 2?")).toBeLessThan(prompt.indexOf(STANDARD));
    expect(prompt).not.toContain("submit_result");
  });

  it("names the evidence and confidence fields when the schema declares them", async () => {
    const script = [
      "interface Finding { where: string; evidence: string; confidence: number; }",
      'const worker = agent("worker");',
      'const f = await worker.ask<Finding>("Find the bug");',
      "return f;",
    ].join("\n");
    const { modelCalls } = await runDriverScript(script, {
      actorScripts: {
        "actor#1@1": [
          { kind: "submit", result: { where: "a.ts:1", evidence: "read it", confidence: 0.5 } },
        ],
      },
    });
    const prompt = modelCalls["actor#1@1"]?.prompts[0] ?? "";
    expect(prompt).toContain("Put each finding's citation in its `evidence` field.");
    expect(prompt).toContain("Rate `confidence` honestly");
  });

  it("nudge prompts carry no epilogue and the journaled inputHash ignores it", async () => {
    const valid = { title: "Repo", points: ["x"] };
    const { modelCalls, journal } = await runDriverScript(TYPED_ASK_SCRIPT, {
      actorScripts: {
        "actor#1@1": [
          { kind: "text", text: "no submit yet" },
          { kind: "submit", result: valid },
        ],
      },
    });
    const prompts = modelCalls["actor#1@1"]?.prompts ?? [];
    expect(prompts.length).toBe(2);
    expect(prompts[0]).toContain(STANDARD);
    expect(prompts[1]).not.toContain(STANDARD);
    expect(prompts[1]).toContain("You ended your turn without submitting a result.");
    expect(journal.getNode(RUN, "ask#1", 1)?.inputHash).toBe(inputHash("Summarize the repo"));
  });

  it("marks where the epilogue starts on the persisted user message; nudge is all epilogue", async () => {
    await withSessionStore(async (store) => {
      const runId = "dwfrun-epilogue-fold";
      const valid = { title: "Repo", points: ["x"] };
      await runDriverScript(TYPED_ASK_SCRIPT, {
        runId,
        sessionStore: store,
        actorScripts: {
          "actor#1@1": [
            { kind: "text", text: "no submit yet" },
            { kind: "submit", result: valid },
          ],
        },
      });
      const persisted = await store.messages({ sessionID: mintActorSessionId(runId, ACTOR_ONE) });
      const users = persisted.filter((message) => message.info.role === "user");
      expect(users.length).toBe(2);
      const askText = users[0]?.parts.find((part) => part.type === "text");
      expect(askText?.type === "text" ? askText.text : "").toContain(STANDARD);
      expect(users[0]?.info.metadata?.epilogueStart).toBe("Summarize the repo".length);
      expect(users[1]?.info.metadata?.epilogueStart).toBe(0);
    });
  }, 30_000);
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("workflow driver — 结算后释放 actor runtime", () => {
  const NOOP_SINK: WorkflowReportSink = {
    askSubmitAttempted: () => {},
    askTurnEnded: () => {},
    askProgress: () => {},
    askStats: () => {},
    askFailed: () => {},
    askWaiting: () => {},
    askExecuting: () => {},
    askMutating: () => {},
    concurrencyChanged: () => {},
    stopRun: () => {},
    runStalled: () => {},
  };

  
  function stubRuntime(close: () => Promise<void> = async () => {}) {
    const closeBrowserSession = vi.fn(close);
    const executeTurn = vi.fn(
      (_input: string, _b: unknown, opts?: { abortSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts?.abortSignal?.addEventListener(
            "abort",
            () => reject(new Error("workflow ask cancelled")),
            {
              once: true,
            },
          );
        }),
    );
    return { closeBrowserSession, executeTurn };
  }

  function driverWith(
    runtimes: Record<string, ReturnType<typeof stubRuntime>>,
    logger?: { warn: (message: string, context?: Record<string, unknown>) => void },
  ) {
    const journal = new InMemoryJournalStore();
    journal.createRun({
      runId: RUN,
      caps: { maxConcurrency: 16 },
      spentTokens: 0,
      status: "running",
    });
    const makeDriver = createAgentRuntimeWorkflowDriver({
      journal,
      emit: () => {},
      escalationRegistry: createWorkflowEscalationRegistry(),
      fileSystemPort: fakeFileSystemPort({}),
      cwd: process.cwd(),
      runId: RUN,
      ...(logger === undefined ? {} : { logger: logger as never }),
      runtimeFactory: ({ actor }) => runtimes[refToString(actor)] as never,
    });
    return makeDriver(NOOP_SINK);
  }

  const A1: ActorRef = { siteId: "actor#1", ordinal: 1 };
  const A2: ActorRef = { siteId: "actor#2", ordinal: 1 };
  const flushMicrotasks = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };

  it("无在飞 turn 的会话立即关；有在飞 turn 的会话等 turn 落地后才关", async () => {
    const idle = stubRuntime();
    const busy = stubRuntime();
    const driver = driverWith({ "actor#1@1": idle, "actor#2@1": busy });
    await driver.createActorSession(A1, {});
    const s2 = await driver.createActorSession(A2, {});
    const instance = { siteId: "ask#1", ordinal: 1 };
    driver.startAsk(s2, instance, { instructions: "go", typed: false });
    expect(busy.executeTurn).toHaveBeenCalledTimes(1);

    driver.cancelAsk(instance);
    driver.dispose?.();
    expect(idle.closeBrowserSession).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(idle.closeBrowserSession).toHaveBeenCalledTimes(1);
    expect(busy.closeBrowserSession).toHaveBeenCalledTimes(1);
  });

  it("在飞 turn 未落地前不关它的 runtime（等待是载荷性的：askStats 在 settle 之后才到）", async () => {
    const busy = stubRuntime();
    busy.executeTurn.mockImplementation(() => new Promise(() => {}));
    const driver = driverWith({ "actor#1@1": busy });
    const s1 = await driver.createActorSession(A1, {});
    driver.startAsk(s1, { siteId: "ask#1", ordinal: 1 }, { instructions: "go", typed: false });

    driver.dispose?.();
    await flushMicrotasks();
    expect(busy.closeBrowserSession).not.toHaveBeenCalled();
  });

  it("幂等：dispose 两次，每个 runtime 只关一次", async () => {
    const r = stubRuntime();
    const driver = driverWith({ "actor#1@1": r });
    await driver.createActorSession(A1, {});
    driver.dispose?.();
    driver.dispose?.();
    await flushMicrotasks();
    expect(r.closeBrowserSession).toHaveBeenCalledTimes(1);
  });

  it("关闭失败只 warn（带 sessionId），结算不因它抛", async () => {
    const r = stubRuntime(async () => {
      throw new Error("browser backend gone");
    });
    const warns: Array<{ message: string; context?: Record<string, unknown> }> = [];
    const driver = driverWith(
      { "actor#1@1": r },
      { warn: (message, context) => warns.push({ message, context }) },
    );
    await driver.createActorSession(A1, {});
    expect(() => driver.dispose?.()).not.toThrow();
    await flushMicrotasks();
    expect(warns).toHaveLength(1);
    expect(warns[0]?.context).toMatchObject({
      errorMessage: "browser backend gone",
      event: "dynamic_workflow.actor_runtime.close_failed",
      sessionId: mintActorSessionId(RUN, A1),
    });
  });

  it("真实管线：run 结算后每个 actor runtime 关闭链恰好一次，且 runtime 可被 GC 回收", async () => {
    const script = [
      "interface A { text: string }",
      'const w1 = agent("w1", "You work.");',
      'const w2 = agent("w2", "You also work.");',
      'const [a, b] = await Promise.all([w1.ask<A>("first"), w2.ask<A>("second")]);',
      "return `${a.text}/${b.text}`;",
    ].join("\n");

    const closes = new Map<string, number>();
    const refs = new Map<string, WeakRef<object>>();
    const { settlement } = await runDriverScript(script, {
      actorScripts: {
        "actor#1@1": [{ kind: "submit", result: { text: "A" } }],
        "actor#2@1": [{ kind: "submit", result: { text: "B" } }],
      },
      onRuntimeCreated: (runtime, key) => {
        closes.set(key, 0);
        const original = runtime.closeBrowserSession.bind(runtime);
        (runtime as { closeBrowserSession: () => Promise<void> }).closeBrowserSession = () => {
          closes.set(key, (closes.get(key) ?? 0) + 1);
          return original();
        };
        refs.set(key, new WeakRef(runtime));
      },
    });
    expect(settlement).toEqual({ status: "completed", artifact: "A/B" });
    expect([...closes.keys()].sort()).toEqual(["actor#1@1", "actor#2@1"]);

    await waitFor(() => [...closes.values()].every((count) => count >= 1));
    for (const [key, count] of closes) expect(count, key).toBe(1);

    setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc") as () => void;
    for (
      let round = 0;
      round < 3 && [...refs.values()].some((ref) => ref.deref() !== undefined);
      round++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      gc();
    }
    for (const [key, ref] of refs) expect(ref.deref(), `${key} 仍被某个根引用`).toBeUndefined();
  });
});
