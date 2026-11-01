---
name: mad
description: Run a MAD (multi-agent deliberation) session for the current workspace — decompose the task, route each step across the models you name, keep an evidence-gated claim graph, arbitrate disagreements, and finalise with provenance. Runs through the CLI control plane (`cf mad ...`) and hands individual work orders to `/workflow`. Use when the user runs /mad, says "mad", "multi-agent", "deliberate", "get a second opinion from another model", "cross-check this with two models", or asks for a plan that several models must agree on.
---

# MAD — multi-agent deliberation

MAD is the control plane, not a chat. The runtime (`@origin-ai/cf-god-runtime`, cordis
services `god-runtime` + `discussion-bus` + `cf-verification`) decomposes the task, routes
every step across the models you name, records claims together with their evidence, and
refuses to finalise while a claim has no evidence. You supply the reasoning; the runtime
supplies the structure, the routing, the budget and the audit trail.

## Rules

- Everything is free: route across whatever models the user has configured. There is no
  plan gate and no model allow-list.
- A claim without evidence stays `proposed` and blocks `finalize`. Evidence is a
  `path:line`, a test name, or a command whose output you actually saw.
- The arbiter never picks a winner from vibes: it counts distinct evidence hashes and
  reports `undecided` on a tie or when both sides are empty.
- Budgets are real: `--tokens`, `--time-ms`, `--cost`, `--concurrency` are enforced by the
  scheduler, and the run stops when a ceiling is hit.

## Start a run

```bash
cf mad run "<task in one sentence>" --mode PLAN|BUILD|DEBUG --models <model-a>,<model-b> [--max-agents N]
cf mad run "<task>" --models <a>,<b> --tokens 200000 --time-ms 1800000 --concurrency 4
```

The command prints the run id, the DAG, and the assignments, then writes two artifacts:

- `.cf/mad/runs/<runId>.json` — the snapshot (tasks, routing, claims, discussion, usage)
- `.cf/mad/runs/<runId>.orders.md` — one work order per task, ready to execute

Modes decompose differently:

| Mode | Steps |
| --- | --- |
| `PLAN` | scope → constraints → architecture → risks → decision |
| `BUILD` | scope → design → implement → verify → report |
| `DEBUG` | reproduce → isolate → hypothesis → fix → regression |

## Execute the work orders with /workflow

Each heading in `<runId>.orders.md` is a self-contained order naming the step, the models
assigned to it, and what to deliver. Run them in order with the `dynamic-workflows` skill
(`/workflow`), one workflow per order, and feed the result back:

```bash
cf mad complete <taskId> --ok      # or --fail
cf mad claim "<what the step proved>" --evidence <path:line>,<test-name>
cf mad discuss "<counterargument>" --kind counterargument --author <model>
```

`/workflow` can also open a MAD run itself: when a workflow step needs several models to
agree before it proceeds, it calls `cf mad run` with the same task text, executes the
orders, and reads the decision back with `cf mad show`. That is the bidirectional link —
MAD never runs a workflow inline, and a workflow never invents its own claim ledger.

## Evidence and arbitration

```bash
cf mad claim "the scanner ignores docs/" --evidence repoScanner.ts:42
cf mad discuss "the fingerprint hashes mtimes, so docs changes are invisible" \
  --kind hypothesis --author model-a

cf mad arbiter model-a model-b \
  --evidence model-a=repoScanner.ts:42,test:scanner \
  --evidence model-b=repoScanner.ts:42
```

The arbiter exits `0` only when one side carries strictly more distinct evidence; a tie or
an evidence-free comparison exits `2` with `undecided`.

## Close the run

```bash
cf mad resolve <claimId> --accept     # rejected automatically if evidence is empty
cf mad finalize                       # prints the report and persists it
cf mad show [runId]                   # tasks, claims, last discussion turns
cf mad list                           # every run, newest first
cf mad cancel "<reason>"              # blocks further mutation
```

`finalize` returns the run id, task/assignment counts, accepted claims, every evidence
hash, the duration, and the scheduler usage. Report that output verbatim — it is the
provenance of the run.

## When not to use

- A single-question answer: one model is enough.
- A mechanical edit with one obvious owner: use `/workflow` directly.
- A review where you only need a second opinion on a diff: `cf mad discuss` inside an
  existing run is cheaper than a new one.
