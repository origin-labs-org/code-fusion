---
name: better-harness
description: Use when /better-harness reviews the outer coding-agent Harness for lifecycle controls, repeated work, project feedback, agent assets, session outcomes, repair planning, durable reports, or finding-bound fixes. Invoke only via slash command.
---

# Better Harness

Review the coding-agent operating system: context, execution, control, feedback,
and learning. Sessions, project, and Agent assets stay independent until joined.

## Step 1: Resolve Scope and Collect the Evidence Bundle

If the prompt contains `<better-harness-fix-output>` or legacy fix callbacks,
read [Finding-bound Fix](references/finding-bound-fix.md) before any probe.

Resolve the Skill path, `<better-harness-root>` as `../..`, a supported `<node>`,
and `<cli>` as
`<node> <better-harness-root>/scripts/better-harness.mjs`. Stop if any owner is
missing; never select another cache or runtime by search order.

Resolve target, decision, acceptance boundary, risks, request language, output
mode, provider scope, and depth. Default to normal; only an explicit request selects quick.
Quick uses three assets or Episodes over 7 days; normal uses five over 30 days. Keep providers
separate; combine only for an authorized project-wide review. Read-only
user/global asset and installed-Plugin metadata is part of the default baseline;
Memory bodies, raw Sessions, marketplace browsing, and historical insights
require explicit scope.

Before delegation, collect one versioned evidence bundle per authorized
provider:

```text
<cli> harness evidence-bundle --platform <provider> --workspace <target> --language <locale> --depth <quick|normal> --since <window-start> --until <window-end> --format json [--include-memories] [--canvas-out <run-dir>/canvas.json]
```

Use `--canvas-out` only for CodeFusion durable reports and
`--include-user-home=false` only when the authorized scope is project-only. For
Codex, Memory metadata still requires `--include-memories`. Neither option
authorizes Memory bodies.
For CodeFusion, keep the primary `<run-dir>` under
`<target>/.cf/better-harness-runs/`; temporary storage is not a durable report.

The command freezes scope once and returns the three evidence lanes plus the lead
analyzer. Agent Customize receives bounded `lint`, `inventory`, and `integrity`
envelopes from one shared asset snapshot. Keep providers and every lane/stage
status distinct. Run an individual owner command only to diagnose a named
unavailable or truncated owner; do not substitute diagnostic output into the
bundle or rerun all owners. Counts for Rules, Skills, MCP, Memory, Agents, Hooks,
Commands, Workflows, and Plugins only route inspection; zero or high counts
never create findings or scores. A normal CodeFusion report with project Memories
blocks when the integrity stage is unavailable.

Treat `coverageRows` as the selected provider's active inventory. Keep
repository-declared assets owned by another provider or plugin in separate
source-only rows; they explain available source code but never change active
counts, findings, or scores.

Inspect historical insights only when provider-discovered or user-supplied and
explicitly authorized. Never assume or search a conventional path; history does
not prove current behavior, capability, or effectiveness.

## Step 2: Run Three Independent Evidence Passes

Launch exactly three fresh, read-only agents in parallel. In Codex use
`spawn_agent` with `fork_turns: "none"`; otherwise run the same briefs locally
and independently. No evidence agent may delegate.

### 2.1 Session Evidence

Give Agent 1 only the provider-labelled Session facts and resolved scope from
the production [Sessions Diagnostics](../../references/session-evidence/sessions-diagnostics.md)
route. Require [Session Evidence](references/session-evidence.md), plus
[Repeated Workflow Discovery](references/session-repeated-workflows.md) when
repeated procedure demand is in scope. Do not expose the complete bundle,
project, configured assets, raw sessions, debug output, or another brief.

### 2.2 Project Harness Evidence

Give Agent 2 only the Project lane, target, scoped history/current-change
boundary, decision, risks, and owner limit. Require [Project Harness Evidence](references/project-harness.md).
Do not expose Session or Agent Customize conclusions.

### 2.3 Agent Customize Evidence

Give Agent 3 only the provider-labelled Agent Customize lint, inventory, and
integrity envelopes; asset authority; decision; risks; and owner limit. Require
[Agent Customize Evidence](references/agent-customize.md). It must not rerun
collection commands or receive Session/Project conclusions.

Each specialist returns only evidence-supported candidates in the reference's
free-form format and never assigns final severity or scores.

While they run, use only the lead analyzer lane. Its global-capability boundary
by default preserves asset counts without authorizing content reads or proving
use; `--include-user-home=false` narrows that boundary to the project.

Stop when the bundle or lead lane fails or omits required evidence. Quick mode
keeps partial/unavailable coverage explicit and lowers confidence; normal mode
blocks on any partial or unavailable specialist. The evidence pass has exactly
three delegated agents.

### 2.4 Skill Recommendation (Optional)

After the three passes, the lead itself applies
[Asset Demand Reconciliation](references/asset-demand-reconciliation.md). Do not
use an Agent merely to load references or read the recommendation reference
before this point.

When Session Evidence returns a supported capability-comparison or workflow-
ownership lead, the lead applies
[Skill Recommendation](references/session-skill-pattern-discovery.md) before
Step 3. This phase is optional across reports but required for each qualified
lead. Analyzer candidates cannot substitute for that specialist decision. First
freeze the demand from sanitized Session evidence without inventory, then compare
actual built-in, configured, project, and non-Skill owners. CodeFusion adds relevant
SDLC entries only in that comparison.
Names, paths, catalog labels, and Skill counts only route inspection. The pass
may recommend a verified trial of existing coverage, extension, creation, a
non-Skill owner, or more evidence. It never creates assets or scores; Step 3
alone turns a qualified disposition into a finding.

## Step 3: Lead Reconciliation and Regrading

Read [Harness Findings Input](../../templates/reporting/harness-findings.input.json)
and [Agent Work Loop](../../models/agent-work-loop.md); never derive their
contracts from prior reports, Memory, recommend files, or validators.

Perform one reconciliation. Start by retaining every specialist candidate.
Merge only the same target, consequence, owner, and repair route; preserve
independent consequences and reasons for every deferral. Never drop an eligible
finding to reach five rows or match the three priority moves. The lead alone:

- validates the consequence, cause chain, smallest owner, evidence boundary,
  confidence, and verifier;
- assigns final severity and one primary Agent Work Loop check;
- derives conservative dimension scores independently from findings count;
- retains disagreements and unavailable evidence at low confidence; and
- writes every distinct supported finding and freezes final severity and
  dimension scores before shaping priority moves, repair prompts, or reader copy.

A specialist or lint classification is still only a lead. Defer inventory
counts, absent assets or owners, placeholder-shaped values, and hypothetical
risks. Promote only when retained evidence proves a present consequence,
explicit governing requirement, or deterministic defect, plus a discovered
executable repair. Never rename an unsupported mechanism into a consequence.
Title only the supported present consequence, not a more severe future scenario.
A repair prompt may start with bounded discovery but must not prescribe provider
syntax or runtime behavior that the evidence did not discover.

Step 3 promotes a fully verified reuse disposition to one ordinary `Low` finding
per demand; counts never raise severity.
Before drafting, apply [Findings Quality Gates](references/findings-review.md).
Confirm that every capability-comparison or workflow-ownership lead has an
evidence-supported disposition and any required recommendation pass has
returned. Do not silently treat a skipped or unavailable pass as no repeated
workflow.

Write dispositions only to `findings[]`; never create a separate suggestions or
recommendation artifact.

After findings and dimension scores are frozen, select one support track. Its
parenthetical ranges are user-journey labels, never score thresholds:

- **Bootstrap (0 -> 1):** initial guidance is explicitly requested, or retained
  findings establish a missing foundational navigation, validation, or risk route.
- **Operationalize (1 -> 60):** relevant mechanisms exist, but retained findings
  show they are not wired into ordinary work or exercised through an outcome.
- **Optimize (60 -> 100):** sufficiently complete Session evidence contains at
  least two distinct comparable Task Episodes for the repeated goal or friction.
- **Undetermined:** the evidence required to select a track is unavailable.

Read only the selected track: [Bootstrap Support](references/support-bootstrap.md),
[Operationalize Support](references/support-operationalize.md), or
[Optimize Support](references/support-optimize.md). It may shape at most three
priority moves for existing findings, but must not add a finding, change
severity, rescore a dimension, or expand evidence or mutation authority.

For a durable report, draft reviewed input only after required evidence passes and any required Skill Recommendation finish.
Do not launch another generic review agent or copy analyzer facts. The lead applies the quality gates once,
preserves all eligible findings, and fixes validation failures before rendering.

## Report Output — Step 4: Render an Authorized Report

Inline analysis writes nothing. Before freezing the reviewed report input,
reapply all five title gates in [Findings Quality Gates](references/findings-review.md)
to every finding. Then render and validate once:

```text
<cli> harness render --findings <run-dir>/findings.json --mode <mode> --out <parent> --run-dir <run-dir> --target <target> --validate --json
```

Use `qoder-harness` mode for CodeFusion and `html` otherwise. CodeFusion analysis
initializes adjacent `canvas.json`; render consumes its `summaryFacts`, then
writes complete `canvas.json` and IDE-readable `findings.json` with bounded `findings[]`.
Codex keeps analyzer `summaryFacts` verbatim. Require `status: pass`; never
hand-write Canvas, Markdown, or HTML.

Finish: `<count> findings. [Open the report](<renderer-path>).` Never duplicate a
qualified recommendation outside the rendered report.
Link the renderer-reported primary report; never return inline-code paths, a bare directory, or an output-file inventory.

## Step 5: Follow Up

- Finding-bound repair uses [Finding-bound Fix](references/finding-bound-fix.md).
  A separate independent post-fix agent may update verified finding state and
  Repair Progress; Loop Effectiveness waits for comparable later Task Episodes.
- Usage/model questions use `session-analysis usage-summary` once.
- Repeated work continues through
  [Loop Discovery](../../references/loop-engineering/loop-discovery.md).
- Detailed routes are available through
  [Agent Customize](../../references/agent-customize/routing.md),
  [Core Change Watch](../../references/project-harness/core-change-watch.md),
  and [Report Routing](../../templates/reporting/routing.md).

Analysis is read-only. Creation, activation, mutation, cleanup, scheduling,
external writes, and high-risk access require separate task-local authority.
When an owner or required value is unresolved, stop with the exact condition to
resume; do not invent a substitute artifact or inspect internal validators.
