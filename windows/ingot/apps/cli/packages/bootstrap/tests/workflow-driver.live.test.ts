

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestAgentRuntime } from "./helpers/test-agent-runtime.js";
import { createInMemorySessionEventStore } from "@origin-ai/cf-adapters/storage";
import { parseModelRef, type RuntimeModelConfig } from "@origin-ai/cf-contracts";
import { AgentRuntime } from "@origin-ai/cf-core";
import { InMemoryJournalStore, inputHash } from "@origin-ai/cf-dynamic-workflow";
import { createModelAdapter } from "../src/index.js";
import { workflowActorToolPolicy } from "../src/app/workflow-actor-tools.js";
import { fakeFileSystemPort, runDriverScript, type PlannedResponse } from "./workflow-driver.helpers.js";
import type { ActorRuntimeFactory } from "../src/app/workflow-driver.js";

interface ResolvedLiveModel {
  modelConfig: RuntimeModelConfig;
  modelRef: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveV2ModelConfig(): ResolvedLiveModel | undefined {
  const configPath = join(homedir(), ".cf", "v2", "config.json");
  if (!existsSync(configPath)) return undefined;
  let providers: Record<string, any>;
  try {
    providers = JSON.parse(readFileSync(configPath, "utf8")).provider ?? {};
  } catch {
    return undefined;
  }
  const providerId = pickActiveProviderId(providers);
  if (providerId === undefined) return undefined;
  const p = providers[providerId];
  const apiKey: string | undefined = p?.options?.apiKey;
  if (!apiKey) return undefined;
  const modelId: string | undefined = process.env.CF_WORKFLOW_LIVE_MODEL ?? Object.keys(p.models ?? {})[0];
  if (!modelId) return undefined;
  return {
    modelConfig: { main: { kind: p.kind, provider: providerId, model: modelId, apiKey, baseURL: p?.options?.baseURL } },
    modelRef: `${providerId}/${modelId}`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickActiveProviderId(providers: Record<string, any>): string | undefined {
  const settingPath = join(homedir(), ".cf", "v2", "setting.json");
  if (existsSync(settingPath)) {
    try {
      const s = JSON.parse(readFileSync(settingPath, "utf8"));
      const key: unknown = s.modelProviderFamilySelectedKeys?.[s.providerFamilyDomain];
      if (typeof key === "string") {
        const id = key.slice(key.indexOf(":") + 1);
        if (providers[id]?.options?.apiKey) return id;
      }
    } catch {
      
    }
  }
  for (const [id, p] of Object.entries(providers)) {
    if (p?.enabled !== false && typeof p?.options?.apiKey === "string" && p.options.apiKey.length > 0) return id;
  }
  return undefined;
}

const RESOLVED = process.env.CF_WORKFLOW_LIVE_TEST ? resolveV2ModelConfig() : undefined;
const LIVE = Boolean(RESOLVED);

function withTranscript<T>(adapter: T): T {
  const path = process.env.CF_WORKFLOW_LIVE_TRANSCRIPT;
  if (!path) return adapter;
  let seq = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = adapter as any;
  const write = (entry: Record<string, unknown>) =>
    appendFileSync(path, `${JSON.stringify({ seq: ++seq, at: new Date().toISOString(), ...entry })}\n`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slim = (req: any) => ({
    model: req?.model,
    toolNames: req?.tools?.map((t: { name: string }) => t.name),
    toolChoice: req?.toolChoice,
    messages: req?.messages,
  });
  const wrapped = Object.create(base);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapped.generateText = async (req: any) => {
    const res = await base.generateText(req);
    write({
      kind: "generateText",
      request: slim(req),
      response: { finishReason: res?.finishReason, text: res?.text, toolCalls: res?.toolCalls, usage: res?.usage },
    });
    return res;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapped.streamText = (req: any) => {
    const inner = base.streamText(req);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = [];
    async function* logged() {
      try {
        for await (const e of inner) {
          events.push(e);
          yield e;
        }
      } finally {
        write({ kind: "streamText", request: slim(req), events });
      }
    }
    return logged();
  };
  return wrapped as T;
}

function liveRuntimeFactory(resolved: ResolvedLiveModel): ActorRuntimeFactory {
  const modelAdapter = withTranscript(
    createModelAdapter({
      env: process.env,
      appVersion: "wf-live-test",
      modelConfig: resolved.modelConfig,
    }),
  );
  const modelRef = parseModelRef(resolved.modelRef);
  const fileSystemPort = fakeFileSystemPort({});
  return ({ sessionId, persona, submitPort }) =>
    createTestAgentRuntime(
      sessionId,
      {
        systemPrompt: persona.system ?? "You are a workflow actor. Follow the instructions precisely.",
        mode: "yolo",
        taskType: "workflow_child",
        subagents: { enabled: false },
        modelRef,
        ...workflowActorToolPolicy(),
      },
      {
        eventStore: createInMemorySessionEventStore(),
        modelAdapter,
        workflowSubmitPort: submitPort,
        fileSystemPort,
      },
    );
}

const noScripts: Record<string, PlannedResponse[]> = {};

describe.skipIf(!LIVE)("workflow driver — LIVE (env-gated)", () => {
  it(
    "a real model submits a schema-conforming result and the run completes",
    async () => {
      const script = [
        "interface Summary { title: string; bullet_points: string[]; }",
        'const worker = agent("worker", "You summarize short texts into a title and bullet points.");',
        'const s = await worker.ask<Summary>("Summarize: The cat sat on the mat, then chased a mouse.");',
        "return s;",
      ].join("\n");

      const { settlement, journal } = await runDriverScript(script, {
        actorScripts: noScripts,
        runtimeFactory: liveRuntimeFactory(RESOLVED!),
        timeoutMs: 120_000,
      });

      expect(settlement.status).toBe("completed");
      const node = journal.getNode("run", "ask#1", 1);
      expect(node?.status).toBe("completed");
      const result = node?.result as { title?: unknown; bullet_points?: unknown } | undefined;
      expect(typeof result?.title).toBe("string");
      expect(Array.isArray(result?.bullet_points)).toBe(true);
    },
    130_000,
  );

  it(
    "resumes over a live-model journal with zero dispatches",
    async () => {
      const script = [
        "interface Answer { value: number; }",
        'const a = await agent("mathy", "You do arithmetic.").ask<Answer>("What is 21 + 21? Return the number.");',
        "return a;",
      ].join("\n");

      const journal = new InMemoryJournalStore();
      const first = await runDriverScript(script, {
        journal,
        actorScripts: noScripts,
        runtimeFactory: liveRuntimeFactory(RESOLVED!),
        timeoutMs: 120_000,
      });
      expect(first.settlement.status).toBe("completed");

      let dispatched = false;
      const throwingFactory: ActorRuntimeFactory = (input) => {
        dispatched = true;
        return liveRuntimeFactory(RESOLVED!)(input);
      };
      const resumed = await runDriverScript(script, {
        journal,
        actorScripts: noScripts,
        runtimeFactory: throwingFactory,
        timeoutMs: 30_000,
      });
      expect(resumed.settlement).toEqual(first.settlement);
      expect(dispatched).toBe(false);
    },
    140_000,
  );
});

describe.skipIf(!LIVE)("workflow driver — LIVE workflow patterns (env-gated)", () => {
  it(
    "seq: threads one ask's typed output into the next actor's prompt",
    async () => {
      const script = [
        "interface Extracted { numbers: number[]; }",
        "interface Parity { even: boolean; }",
        'const extractor = agent("extractor", "You extract integers from text.");',
        'const e = await extractor.ask<Extracted>("Extract all the integers: there are 3 cats, 5 dogs and 14 birds.");',
        "const sum = e.numbers.reduce((a, b) => a + b, 0);",
        'const checker = agent("checker", { system: "You answer arithmetic questions." });',
        "const p = await checker.ask<Parity>(`Is the number ${sum} even?`);",
        "return { sum, even: p.even };",
      ].join("\n");

      const { settlement, journal } = await runDriverScript(script, {
        actorScripts: noScripts,
        runtimeFactory: liveRuntimeFactory(RESOLVED!),
        timeoutMs: 150_000,
      });

      expect(settlement.status).toBe("completed");
      if (settlement.status !== "completed") return;

      const extracted = journal.getNode("run", "ask#1", 1)?.result as { numbers: number[] };
      expect(Array.isArray(extracted.numbers)).toBe(true);
      const sum = extracted.numbers.reduce((a, b) => a + b, 0);
      const artifact = settlement.artifact as { sum: number; even: boolean };
      expect(artifact.sum).toBe(sum);
      expect(artifact.even).toBe(sum % 2 === 0);
      expect(journal.getNode("run", "ask#2", 1)?.inputHash).toBe(inputHash(`Is the number ${sum} even?`));
    },
    170_000,
  );

  it(
    "parallel: fans out over Promise.all onto fresh actors, then reduces via an aggregator ask",
    async () => {
      const script = [
        "interface Value { value: number; }",
        "interface Total { total: number; }",
        'const problems = ["2 + 3", "10 + 4", "7 + 6"];',
        "const values = await Promise.all(",
        '  problems.map((p) => agent("solver").ask<Value>(`Compute ${p} and return the value.`)),',
        ");",
        "const nums = values.map((v) => v.value);",
        'const agg = await agent("aggregator", { system: "You add numbers." })',
        "  .ask<Total>(`Add these numbers: ${nums.join(", ")}. Return the total.`);",
        "return { nums, total: agg.total };",
      ].join("\n");

      const { settlement, journal, events } = await runDriverScript(script, {
        actorScripts: noScripts,
        runtimeFactory: liveRuntimeFactory(RESOLVED!),
        timeoutMs: 180_000,
      });

      expect(settlement.status).toBe("completed");
      if (settlement.status !== "completed") return;

    const askNodes = journal
      .listNodes("run", { kinds: "all", withResult: true })
      .filter((n) => n.kind === "ask");
    expect(askNodes).toHaveLength(4);
    expect(askNodes.every((n) => n.status === "completed")).toBe(true);
    expect(events.filter((e) => e.type === "actor-created")).toHaveLength(4);

      const artifact = settlement.artifact as { nums: number[]; total: number };
      expect(artifact.nums).toEqual([5, 14, 13]);
      expect(artifact.total).toBe(32);
      const fanned = askNodes
        .filter((n) => n.siteId === "ask#1")
        .map((n) => (n.result as { value: number }).value);
      expect(fanned).toHaveLength(3);
      expect(fanned.reduce((a, b) => a + b, 0)).toBe(artifact.total);
    },
    200_000,
  );

  it(
    "control: branches on a typed enum verdict; only the taken branch's ask is journaled",
    async () => {
      const script = [
        'interface Verdict { sentiment: "positive" | "negative"; }',
        'const judge = agent("judge", { system: "You classify sentiment." });',
        'const v = await judge.ask<Verdict>("Classify the sentiment: I absolutely love this product, it works perfectly.");',
        'if (v.sentiment === "positive") {',
        '  const cheer = await agent("fan").ask("Reply with one short cheerful sentence.");',
        "  return { sentiment: v.sentiment, reply: cheer };",
        "}",
        'const sigh = await agent("consoler").ask("Reply with one short consoling sentence.");',
        "return { sentiment: v.sentiment, reply: sigh };",
      ].join("\n");

      const { settlement, journal } = await runDriverScript(script, {
        actorScripts: noScripts,
        runtimeFactory: liveRuntimeFactory(RESOLVED!),
        timeoutMs: 150_000,
      });

      expect(settlement.status).toBe("completed");
      if (settlement.status !== "completed") return;

      const verdictNode = journal.getNode("run", "ask#1", 1);
      const verdict = (verdictNode?.result as { sentiment: string } | undefined)?.sentiment;
      expect(["positive", "negative"]).toContain(verdict);
      expect(journal.getNode("run", "ask#2", 1) !== undefined).toBe(verdict === "positive");
      expect(journal.getNode("run", "ask#3", 1) !== undefined).toBe(verdict === "negative");
      const artifact = settlement.artifact as { sentiment: string; reply: string };
      expect(artifact.sentiment).toBe(verdict);
      expect(typeof artifact.reply).toBe("string");
      expect(artifact.reply.length).toBeGreaterThan(0);
    },
    170_000,
  );

  it(
    "actor context: a second ask on the same actor recalls facts from the first (FIFO, one runtime)",
    async () => {
      const script = [
        "interface Ack { ok: boolean; }",
        "interface Recall { codeword: string; }",
        'const keeper = agent("keeper", "You remember facts from this conversation and answer recall questions.");',
        'await keeper.ask<Ack>("Remember the codeword PLUM-42. Reply with ok=true.");',
        'const r = await keeper.ask<Recall>("What codeword were you asked to remember earlier in this conversation? Return exactly that codeword.");',
        "return r;",
      ].join("\n");

      const { settlement, journal, events } = await runDriverScript(script, {
        actorScripts: noScripts,
        runtimeFactory: liveRuntimeFactory(RESOLVED!),
        timeoutMs: 150_000,
      });

      expect(settlement.status).toBe("completed");
      if (settlement.status !== "completed") return;

      expect((settlement.artifact as { codeword: string }).codeword).toContain("PLUM-42");
      expect(events.filter((e) => e.type === "actor-created")).toHaveLength(1);
      const first = journal.getNode("run", "ask#1", 1);
      const second = journal.getNode("run", "ask#2", 1);
      expect(first?.actorSiteId).toBe("actor#1");
      expect(second?.actorSiteId).toBe("actor#1");
      expect(first?.actorSeq).toBe(0);
      expect(second?.actorSeq).toBe(1);
    },
    170_000,
  );

  it(
    "loop: a feedback-driven loop converges — each round threads script feedback into the next ask",
    async () => {
      const script = [
        "interface Guess { value: number; }",
        'const guesser = agent("guesser", { system: "You guess integers, using the feedback on your earlier guesses." });',
        'let feedback = "none yet";',
        "let found = -1;",
        "let rounds = 0;",
        "for (let i = 0; i < 6 && found === -1; i++) {",
        "  rounds = i + 1;",
        "  const g = await guesser.ask<Guess>(`Guess the secret integer between 1 and 10. Feedback on your previous guess: ${feedback}.`);",
        "  if (g.value === 7) { found = g.value; }",
        "  else { feedback = g.value < 7 ? `${g.value} is too low` : `${g.value} is too high`; }",
        "}",
        "return { found, rounds };",
      ].join("\n");

      const { settlement, journal, events } = await runDriverScript(script, {
        actorScripts: noScripts,
        runtimeFactory: liveRuntimeFactory(RESOLVED!),
        timeoutMs: 300_000,
      });

      expect(settlement.status).toBe("completed");
      if (settlement.status !== "completed") return;

    const artifact = settlement.artifact as { found: number; rounds: number };
    expect(artifact.found).toBe(7);
    expect(artifact.rounds).toBeGreaterThanOrEqual(1);
    expect(artifact.rounds).toBeLessThanOrEqual(6);
    const askNodes = journal
      .listNodes("run", { kinds: "all", withResult: true })
      .filter((n) => n.kind === "ask");
    expect(askNodes).toHaveLength(artifact.rounds);
    expect(askNodes.every((n) => n.status === "completed" && n.actorSiteId === "actor#1")).toBe(
      true,
    );
    expect(events.filter((e) => e.type === "actor-created")).toHaveLength(1);
    expect(journal.getNode("run", "ask#1", artifact.rounds)?.actorSeq).toBe(artifact.rounds - 1);
  }, 320_000);

  it(
    "world reads: file content read by the harness is consumed by a live typed ask",
    async () => {
      const script = [
        "interface Config { port: number; }",
        'const text = await files.read("config/server.txt");',
        'const parser = agent("parser", { system: "You extract fields from configuration text." });',
        "const c = await parser.ask<Config>(`In the following config, what is the port?\\n${text}`);",
        "return c;",
      ].join("\n");

      const content = "host = example.com\nport = 4823\ntimeout = 30\n";
      const { settlement, journal } = await runDriverScript(script, {
        actorScripts: noScripts,
        runtimeFactory: liveRuntimeFactory(RESOLVED!),
        files: { read: content },
        timeoutMs: 130_000,
      });

      expect(settlement.status).toBe("completed");
      if (settlement.status !== "completed") return;

      expect(journal.getNode("run", "world-read#1", 1)?.result).toBe(content);
      expect((settlement.artifact as { port: number }).port).toBe(4823);
    },
    150_000,
  );
});
