import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runMadCommand } from "../../../cli/src/mad-command.ts";

const options = { force: false, json: false, noColor: true, verbose: false };

const makeCtx = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    ctx: {
      argv: [],
      stdin: process.stdin,
      stdout: { write: (chunk: string) => { out.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { err.push(chunk); return true; } },
    } as never,
  };
};

const workspace = async () => {
  const dir = await mkdtemp(join(tmpdir(), "cf-mad-"));
  return { dir, deps: { cwd: () => dir } };
};

test("mad run persists a snapshot and work orders", async () => {
  const { dir, deps } = await workspace();
  const { ctx, out, err } = makeCtx();
  const code = await runMadCommand(ctx, options, deps, [
    "run", "document", "the", "repo", "--models", "model-a,model-b", "--mode", "BUILD",
  ]);
  assert.equal(code, 0, err.join(""));
  const printed = out.join("");
  assert.match(printed, /MAD run run-[a-z0-9]+ \[BUILD\] started/);
  assert.match(printed, /scope-1 \(scope\) → model-a#1, model-b#1/);

  const latest = JSON.parse(await readFile(join(dir, ".cf", "mad", "latest.json"), "utf8")) as { runId: string };
  const snapshot = JSON.parse(
    await readFile(join(dir, ".cf", "mad", "runs", `${latest.runId}.json`), "utf8"),
  ) as { tasks: { id: string; assigned: string[] }[]; mode: string };
  assert.equal(snapshot.mode, "BUILD");
  assert.equal(snapshot.tasks.length, 5);
  assert.deepEqual(snapshot.tasks[0]?.assigned, ["model-a#1", "model-b#1"]);

  const orders = await readFile(join(dir, ".cf", "mad", "runs", `${latest.runId}.orders.md`), "utf8");
  assert.match(orders, /## scope-1 — scope/);
  assert.match(orders, /agents: model-a#1, model-b#1/);
});

test("mad run requires models", async () => {
  const { deps } = await workspace();
  const { ctx, err } = makeCtx();
  const code = await runMadCommand(ctx, options, deps, ["run", "no", "models"]);
  assert.equal(code, 1);
  assert.match(err.join(""), /Missing --models/);
});

test("claims need evidence before they can be accepted", async () => {
  const { deps } = await workspace();
  const first = makeCtx();
  assert.equal(
    await runMadCommand(first.ctx, options, deps, ["run", "test", "run", "--models", "m1"]),
    0,
    first.err.join(""),
  );

  const claim = makeCtx();
  assert.equal(await runMadCommand(claim.ctx, options, deps, ["claim", "the", "sky", "is", "blue"]), 0);
  const claimId = /claim-[a-z0-9]+-\d+/.exec(claim.out.join(""))?.[0];
  assert.ok(claimId, claim.out.join(""));
  assert.match(claim.out.join(""), /stays 'proposed'/);

  const resolve = makeCtx();
  const code = await runMadCommand(resolve.ctx, options, deps, ["resolve", claimId!, "--accept"]);
  assert.equal(code, 1);
  assert.match(resolve.err.join(""), /no evidence/);

  const supported = makeCtx();
  assert.equal(
    await runMadCommand(supported.ctx, options, deps, ["claim", "the", "sky", "is", "blue", "--evidence", "test:sky"]),
    0,
  );
  const supportedId = /claim-[a-z0-9]+-\d+/.exec(supported.out.join(""))?.[0];
  const accept = makeCtx();
  assert.equal(await runMadCommand(accept.ctx, options, deps, ["resolve", supportedId!, "--accept"]), 0);
  assert.match(accept.out.join(""), /\[accepted\]/);
});

test("arbiter is evidence-gated and reportable as json", async () => {
  const { deps } = await workspace();
  const undecided = makeCtx();
  const code = await runMadCommand(undecided.ctx, options, deps, ["arbiter", "a", "b"]);
  assert.equal(code, 2);
  assert.match(undecided.out.join(""), /undecided/);

  const decided = makeCtx();
  const json = { ...options, json: true };
  const exit = await runMadCommand(decided.ctx, json, deps, [
    "arbiter", "a", "b", "--evidence", "a=t1,t2", "--evidence", "b=t1",
  ]);
  assert.equal(exit, 0);
  const payload = JSON.parse(decided.out.join("")) as { winner: string; decisive: boolean };
  assert.equal(payload.winner, "a");
  assert.equal(payload.decisive, true);
});

test("status and finalize read the persisted run", async () => {
  const { deps } = await workspace();
  const start = makeCtx();
  await runMadCommand(start.ctx, options, deps, ["run", "status", "check", "--models", "m1"]);

  const status = makeCtx();
  assert.equal(await runMadCommand(status.ctx, options, deps, ["status"]), 0);
  assert.match(status.out.join(""), /god-runtime \+ discussion-bus \+ cf-verification/);
  assert.match(status.out.join(""), /latest: run-/);

  const finalize = makeCtx();
  assert.equal(await runMadCommand(finalize.ctx, options, deps, ["finalize"]), 0);
  const report = JSON.parse(finalize.out.join("")) as { status: string; tasks: number };
  assert.equal(report.status, "finalized");
  assert.equal(report.tasks, 5);
});

test("cancel blocks further mutation", async () => {
  const { deps } = await workspace();
  const start = makeCtx();
  await runMadCommand(start.ctx, options, deps, ["run", "cancel", "me", "--models", "m1"]);
  assert.equal(await runMadCommand(makeCtx().ctx, options, deps, ["cancel", "operator", "stop"]), 0);

  const claim = makeCtx();
  const code = await runMadCommand(claim.ctx, options, deps, ["claim", "late", "claim"]);
  assert.equal(code, 1);
  assert.match(claim.err.join(""), /cancelled/);
});
