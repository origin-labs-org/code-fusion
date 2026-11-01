import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { apply as applyInvariants } from "@origin-ai/cf-invariants";
import {
  Arbiter,
  GodRuntime,
  Router,
  Scheduler,
  claimId,
  credentialId,
  instanceId,
  modelId,
  providerId,
  taskId,
  type MadRunSnapshot,
} from "../src/index.ts";

const instance = (id: string) => ({
  id: instanceId(id),
  modelId: modelId("test-model"),
  providerId: providerId("test-provider"),
  credentialId: credentialId("test-credential"),
  available: true,
  healthy: true,
});

const makeRuntime = (budgets = { concurrency: 4, tokens: 10_000 }) => {
  const ctx = new Context();
  applyInvariants(ctx);
  const runtime = new GodRuntime(ctx, { budgets, maxAgents: 2 });
  runtime.registry.register({
    id: providerId("test-provider"),
    name: "Test",
    credentials: [
      {
        id: credentialId("test-credential"),
        providerId: providerId("test-provider"),
        models: [
          { id: modelId("test-model"), name: "test-model", instances: [instance("i-1"), instance("i-2")] },
        ],
      },
    ],
  });
  return runtime;
};

test("router filters unhealthy instances and ranks by score", () => {
  const router = new Router();
  const healthy = instance("i-1");
  const sick = { ...instance("i-2"), healthy: false };
  const result = router.route(
    [healthy, sick],
    { capability: "scope" },
    new Map([[instanceId("i-1"), {
      voi: 1, historicalPerformance: 0.5, evidenceQuality: 1, latencyMs: 10, cost: 0,
      correlationRisk: 0, diversityBenefit: 0.5,
    }]]),
    1,
  );
  assert.deepEqual(result.selected.map((i) => i.id), [instanceId("i-1")]);
  assert.deepEqual(result.excluded.map((e) => e.instanceId), [instanceId("i-2")]);
  assert.equal(result.excluded[0]?.reason, "provider health (backoff)");
});

test("router records outcomes and reports empirical performance", () => {
  const router = new Router();
  router.recordOutcome(instanceId("i-1"), taskId("t"), true);
  router.recordOutcome(instanceId("i-1"), taskId("t"), false);
  assert.equal(router.empiricalPerformance(instanceId("i-1")), 0.5);
});

test("scheduler enforces budgets and exponential backoff", () => {
  const scheduler = new Scheduler({ concurrency: 1, tokens: 100 });
  assert.equal(scheduler.reserveResources(1, 60), true);
  assert.equal(scheduler.reserveResources(1, 10), false);
  scheduler.releaseResources("a");
  assert.equal(scheduler.reserveResources(1, 40), true);
  assert.equal(scheduler.isExhausted(), true);

  const backoff = scheduler.handleFailure("a", "429");
  assert.equal(backoff.attempts, 1);
  assert.equal(backoff.retryAllowed, true);
  assert.equal(scheduler.isBackingOff("a"), true);
  scheduler.handleFailure("a", "429");
  const final = scheduler.handleFailure("a", "429");
  assert.equal(final.retryAllowed, false);
});

test("arbiter never decides without evidence and breaks ties explicitly", () => {
  const arbiter = new Arbiter();
  const empty = arbiter.decide({ label: "a", evidence: [] }, { label: "b", evidence: [] });
  assert.equal(empty.decisive, false);
  assert.equal(empty.winner, undefined);

  const tie = arbiter.decide({ label: "a", evidence: ["h1"] }, { label: "b", evidence: ["h2"] });
  assert.equal(tie.decisive, false);

  const decided = arbiter.decide(
    { label: "a", evidence: ["h1", "h2"] },
    { label: "b", evidence: ["h1"] },
  );
  assert.equal(decided.decisive, true);
  assert.equal(decided.winner, "a");
  assert.deepEqual(decided.evidenceHashes, ["h1", "h2"]);
});

test("god runtime runs a full planning session end to end", async () => {
  const runtime = makeRuntime();
  const initial = await runtime.initializeTask({ description: "Plan the repo wiki refresh", mode: "PLAN" });
  assert.equal(initial.status, "running");

  const tasks = await runtime.decomposeTask();
  assert.deepEqual(tasks, ["scope-1", "constraints-2", "architecture-3", "risks-4", "decision-5"].map((id) => taskId(id)));

  const routed = runtime.routeTask(taskId("scope-1"));
  assert.equal(routed.length, 2);

  runtime.discuss("hypothesis", "the wiki is stale because the fingerprint ignores docs/");
  const proposed = runtime.recordClaim({ text: "the scanner skips docs/" });
  assert.equal(proposed.status, "proposed");
  assert.throws(() => runtime.resolveClaim(claimId(proposed.id), true), /no evidence/);

  const supported = runtime.recordClaim({
    text: "the scanner skips docs/",
    evidence: ["repoScanner.ts:42", "test:repo-wiki/scanner"],
  });
  assert.equal(supported.status, "supported");
  assert.equal(runtime.checkProgress(), true);

  runtime.completeTask(taskId("scope-1"), true);
  const accepted = runtime.resolveClaim(claimId(supported.id), true);
  assert.equal(accepted.status, "accepted");

  const report = runtime.finalize();
  assert.equal(report.status, "finalized");
  assert.equal(report.tasks, 5);
  assert.equal(report.acceptedClaims, 1);
  assert.deepEqual(report.evidenceHashes, ["repoScanner.ts:42", "test:repo-wiki/scanner"]);
});

test("snapshot round-trips through a restored runtime", async () => {
  const runtime = makeRuntime();
  await runtime.initializeTask({ description: "Resume me", mode: "DEBUG" });
  await runtime.decomposeTask();
  runtime.routeTask(taskId("reproduce-1"));
  runtime.recordClaim({ text: "reproduced", evidence: ["cmd:test"] });
  const snapshot: MadRunSnapshot = runtime.snapshot();

  const ctx = new Context();
  applyInvariants(ctx);
  const restored = GodRuntime.restore(ctx, JSON.parse(JSON.stringify(snapshot)) as MadRunSnapshot);
  const again = restored.snapshot();
  assert.equal(again.runId, snapshot.runId);
  assert.equal(again.tasks.length, snapshot.tasks.length);
  assert.equal(again.claims.length, 1);
  assert.equal(again.discussion.length, snapshot.discussion.length);
  assert.equal(again.usage.tokensUsed, snapshot.usage.tokensUsed);
});

test("cancelling a run blocks further mutation", async () => {
  const runtime = makeRuntime();
  await runtime.initializeTask({ description: "Cancel me" });
  runtime.cancelRun("operator stop");
  assert.throws(() => runtime.decomposeTask(), /cancelled/);
  assert.equal(runtime.finalize().status, "cancelled");
});
