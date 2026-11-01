# CodeFusion Canvas Output

This file owns Canvas artifact shape, runtime rules, chat handoffs, and validation; `skills/better-harness/SKILL.md#report-output` owns reader fields, and style guidance never owns a second report schema.

## Artifact flow

- `harness analyze --format json --canvas-out <run>/canvas.json` returns neutral, budgeted plain-text evidence and initializes Canvas with exact `summaryFacts`. It excludes projected conclusions; the lead judges only evidence and authors the reviewed report input without copying machine facts. Render automatically consumes the adjacent analyzer-owned Canvas, then replaces it with the final standalone Canvas report; explicit `--canvas` remains available for a selected legacy companion. Existing analyzer output is replaced only with separately authorized `--replace-canvas`.
- `/better-harness` always uses Agent Work Loop; session availability changes its evidence mode, not the visible model. Use the Software Fluency scaffold only for an explicitly requested static project scan.
- The visible artifact bundle is `findings.json`, `canvas.json`, and `report.canvas.tsx`. The Canvas imports only `qoder/canvas`, React state when needed for local disclosure or range controls, and `./canvas.json`; do not add helper modules, network access, Node built-ins, local SDK imports, or `./findings.json`.
  Final `findings.json` has exactly the top-level `summary` and `findings` fields; its bounded finding rows retain the host cards, dimension links, and AI Fix contract. Final `canvas.json` is the complete structured report and owns exact evidence, usage, Learning Capture, bounded Memory detail, and the complete finding rows.
- Render into the requested run directory and validate the final bundle.
- Current Canvas selection requires the exact v4/report-v23 pair and rejects mixed versions. Only the prior-state loader may restore a complete exact-project v21 or v22 intervention ledger as bounded later-validation continuity.

## AI authoring and reader mode

This is a Canvas-backed findings report contract, not a generic dashboard recipe. The owner orders supported findings and owns evidence joins; the shipped shell provides the final validated composition. Do not edit generated files after the owner succeeds, and never invent diagnosis or user benefit.

The canonical reader foundation is owned by the Canvas SDK: render the page with `ReportShell`, render each primary reader block with `ReportSection`, and render paired charts with `ChartContainer` inside `ChartComparisonGrid`. Do not replace these with a locally padded root `Stack`, local page-width styles, local chart cards, or page-specific theme colors.
The shared foundation owns the 960 px reading width, responsive page padding, section rhythm, chart plot alignment, and light/dark semantic surfaces.
Compose peer page-level sections in one `Stack` using `canvasSemanticSpacing.reportSection`. Keep these primary sections borderless: use whitespace, not repeated horizontal divider lines, to separate one primary heading and content block from the next. Dividers remain valid only inside a component
when they communicate row, disclosure, or subordinate-content structure.

Software Fluency keeps its score card and score visual. Agent Work Loop renders one compact SDK `Fluency` visual from the five evidence-bounded `summary.dimensions[]`
scores and uses each row's `summary` as the only hover content: do not repeat the dimension category or score. The fifth bar is **Learning Capture** and follows the same reader treatment; do not expose supporting-check ids,
numbering, or stage progression in its tooltip. It must not average them or synthesize another score, percentage, maturity level, radar, progress bar, or evidence-state count chart.
Follow the field semantics in `skills/better-harness/SKILL.md#report-output`: a finding title names the concrete issue,
`reason` explains current cost, and `expectedOutput` lists one to three direct goal-oriented deliverables that combine the artifact action,
reviewed safe file intent, and purpose/result in one sentence. Reject a bare label such as `Update the Rule`; `aiFixPrompt` remains hidden action transport.

Render findings as one full-width Canvas SDK `ImprovementList`, with each finding in an
`ImprovementDisclosure` row separated by a divider. Keep severity and the first mapped
dimension category in the row, show the complete title and bounded `reason`, and expand
Cause and Expected Output in place beneath their parent row. Do not wrap findings in Cards,
place them in a Grid, or create a second dialog hierarchy.
Plan AI Fix opens instructions in chat for review before sending; never print them.
`expectedArtifact` remains an internal owner/type signal and must not be rendered as a separate Deliverable.
When the file owner is unknown, require locating it before editing; do not invent a path from a Rule, Hook, workflow, configuration, or other non-file-specific owner.
The report header contains no IDE-only Harness Expert jump. Practice coverage uses fixed category descriptions, counts, scopes, and safe paths—not observations.
The Agent Customize table and repository-provider cards omit placeholder letter icons; provider cards use one standard content inset instead of a cramped header strip.
Memory is the source-path exception: keep analyzer-owned `summary.aiAgentPractice.memoryDetails` as constant-size Project/Global and integrity aggregates, merge it before the final standalone `canvas.json` is written, and never copy it into final `findings.json` or render Memory titles, paths, bodies, or personal categories.

Use `summary.usageActivity` for script-aggregated UTC daily session activity, distinct model-active sessions, and deduplicated Skill observations; use `summary.usageEfficiency` for the separate all-eligible raw model-call census and accounting boundary.
The durable `/better-harness` analyzer supplies both usage fields when eligible sessions exist; if a legacy source omits them, show usage as unavailable, never `0/0`, zero models, zero source gaps, or low sampling confidence.
The visible overview keeps only analyzed/eligible sessions, estimated active minutes, Skill observations, estimated active-long sessions, and bounded top Skills. Render Evidence and methodology as a visible decision brief: one evidence-boundary callout, sampling confidence, source gaps, delivery outcome evidence, the pending long-session review queue, and three representative evidence-bearing session observations. Put session composition, raw call attribution, model-response accounting, wall-only spans, sampling provenance, and the complete model table behind one default-collapsed Measurement and model details disclosure. Unreviewed long-session candidates retain safe task summary, role, estimate, failures, and `sessionRef` in structured evidence, but the default row must not display the analysis reference; they do not enter Improvements. Keep every observation reachable through one user-triggered detail dialog. Never expose raw session ids in visible fields; only a user-triggered AI Fix may carry them for local lookup. Do not replace task summaries with ids or call activity frequency a user preference, model quality, or cost.
Use an info Notice for unavailable measurement context; the closed measurement disclosure shows only its primary title and trailing availability.
For Agent Work Loop, keep this reader order:

1. A short project introduction, then one compact SDK `Fluency` visual backed by
   five dimension scores and evidence-bound summaries; hover explains, without an average.
   The fifth hover explains the conservative Learning Capture score without
   exposing internal stage progression or turning evidence state into a fixed
   score band. When the reviewed explanation is one complete sentence, pass it
   through the shared Fluency tooltip `content` field so wrapping does not invent
   a title/body hierarchy. Only an `Outcome-supported` later-validation result permits an
   improvement or `Effective` claim.
2. One full-width borderless `summary.usageActivity` section: a plain Project usage heading,
   a fixed six-month SDK `ActivityHeatmap` with previous/next six-month window navigation in the date header, grouped month labels, responsive square cells, the shared green activity scale and legend, and date/minutes hover labels, plus compact session insights,
   and bounded Skills. Keep only the chart in the activity layer; only its plot may scroll, and when it does its initial viewport shows the latest dates. Present Activity insights and Most used Skills as two peer regions in the shared responsive divided `Grid`: use the shared `section` spacing token around a vertical semantic divider side by side and switch to a horizontal divider when the regions stack. The Skill rows are value comparisons rather than a leaderboard: omit ordinal numbers, render Skill names with the same secondary label tone as the left-side metrics, and render counts with the same primary semibold value treatment.
3. Complete findings in one full-width `ImprovementList`; each `ImprovementDisclosure` owns its row-scoped `Plan AI Fix` and inline closed detail.
   Keep rows flat and separated by dividers; do not restore a finding-card Grid. Severity must use the shared semantic `Tag` so its foreground, background, and border come from status tokens. Keep this row-scoped `Plan AI Fix` label at the explicitly compact 11px size; this is a report-action exception, not a global Button size change.
4. Agent Customize uses one SDK `Table` at default readable density with semantic label, metric, and description columns for Asset, Coverage, and Representative source; show provenance scopes as subdued text rather than status Tags. Keep the first safe non-Memory path visible and remaining paths in the row's closed `SourceLocationsDisclosure`. Its leading chevron and label must use the same alignment and interaction language as the `ImprovementDisclosure` detail row; do not create a trailing-chevron variant. When the source count exceeds the safe paths supplied to the report, retain that subordinate detail entry and state the unsupplied remainder instead of inventing paths. Repository-provider cards use one standard 16px content inset. The Memory row instead opens its bounded metadata and integrity detail.
5. Responsive daily model-active-session and Skill-observation SDK `AreaChart` trends, limited to the latest 30 recorded days and top five labels plus `Other`. Each trend uses `ChartContainer` for title, description, plot, footer, and caption; the pair uses `ChartComparisonGrid` so plots share a bottom-aligned visual region.
6. One directly readable, compact Evidence and methodology decision brief: a small-text evidence boundary,
   three semantic status cards, one long-session review queue and handoff, and three responsive observation cards. Render the boundary through the shared token-backed `Callout`: use `info` only when both sampling and activity coverage are present, otherwise use `warning`.
   Keep complete observations in one dialog and sampling/accounting/model detail behind one quiet closed disclosure.

Do not add a separate work-stage coverage or highest-priority decision card;
Fluency already presents the stage scores and the findings list owns every
evidence-backed improvement. Do not restore the old horizontally scrolling Kata row, wide findings table, or multi-metric capability matrix; they clip inside IDE panels.
Detailed inspection tables may use compact density, but the primary Agent Customize inventory keeps default readable density.
Do not ask newcomers to interpret `Present`, `Wired`, question counts, confidence, autonomy radius, ids, or evidence bridges in the main reader flow.
Keep the complete five-question and fifteen-check report in `canvas.json`;
retain in `findings.json` only the deterministic host summary projection. The
Fluency visual may show only the dimension label, score, and evidence-bound summary; do not
repeat checks, refs, confidence, or evidence bridges as a chart, overview table,
or accordion.

## Chat handoff and validation
Bind `SendToChatButton.text` to `row.aiFixPrompt` with `options={{ submit: false }}`.
The visible label is short and localized; the full prompt remains action transport, not the newcomer explanation.

Run:
```text
<node> scripts/harness-analysis/validate-canvas.mjs --canvas <run>/report.canvas.tsx
```
The validator discovers sibling `findings.json` and `canvas.json`. It must
validate the host summary and finding projection against the standalone Canvas report, copied
shell imports, the evidence/score branch, and row-scoped handoff. Use preview or browser inspection when
available; static declarations alone do not prove Canvas execution.
