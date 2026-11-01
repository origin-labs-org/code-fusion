# Session-derived Skill Evaluation

Use this maintainer route to test whether the current IDE Agent can discover
reusable workflow patterns in bounded, privacy-safe session evidence and make a
defensible Skill-owner decision. The IDE Agent is the tested model. No Node
script starts `qodercli`, `codex`, or another provider for this workflow.

The Prompt contract is the Better Harness
[Skill Recommendation](../../skills/better-harness/references/session-skill-pattern-discovery.md)
reference. Production Better Harness may load it only through the optional
Skill Recommendation route; this maintainer route tests it directly. It is not a
second, independently discoverable Skill. Neither route authorizes capability
creation, and generated sessions never become organic demand.

## Distribution Boundary

The evaluator CLI, its benchmark corpus, and the commands below are
repository-maintainer tools. They are supported only from a full source
checkout that contains `scripts/session-evidence-eval.mjs` and
`benchmark/session-evidence-jsonl/`. The npm package intentionally excludes the
evaluator CLI and corpus. The generated runtime bundle does not ship the corpus,
so it does not expose these commands as a supported installed entry either.

The published Better Harness entry is the routed
[Skill Recommendation](../../skills/better-harness/references/session-skill-pattern-discovery.md)
reference used by the optional production recommendation. An Agent reading this
page from an installed package or runtime bundle must use that production route
and stop before the source-checkout commands below.

## Boundary

```mermaid
flowchart LR
  A["Provider-local session"] --> B["Deterministic selection and redaction"]
  B --> P1["Episode-only discovery packet"]
  P1 --> D["Semantic pattern discovery"]
  D --> F["Validated freeze receipt"]
  F --> P2["Capability and owner overlay"]
  P2 --> V["Advisory owner analysis"]
  V --> R["Hash-bound record"]
  R --> J["Independent IDE or human adjudication"]
```

Scripts may select, deduplicate, redact, project, validate refs and schemas,
hash inputs, and persist supplied text. They do not infer task family, semantic
similarity, workflow pattern, capability completeness, smallest owner, or the
correct action.

## What the recent corpus can prove

The six committed pilot replays are three benchmark scenarios run once through
each provider. Each pair is a replica group, not two independent demands. The
corpus can exercise whether a reviewer separates provider replicas from
independent recurrence, distinguishes configured capability from observed use,
grounds a proposed pattern in the supplied Episodes and owners, and preserves
declared stopping and omission boundaries.

The corpus intentionally contains no canonical workflow pattern, expected
owner, or expected action. A reviewer may return no pattern or a defensible
alternative pattern when its cited evidence supports that result. Because all
six replays are benchmark-generated, none can prove natural recurrence or
justify `create-skill` by itself. Organic evidence must enter through a separate
privacy-safe packet and still pass independent adjudication.

## Source-checkout maintainer workflow

From the full source checkout, inspect the corpus and produce an oracle-free,
Episode-only discovery packet:

```text
node scripts/session-evidence-eval.mjs skill-list
node scripts/session-evidence-eval.mjs skill-extract --case <case-id> --output <discovery-packet.json>
```

Create a fresh IDE task and give it the routed reference plus the repository
[benchmark schema](../../benchmark/session-evidence-jsonl/v1/skill-pattern.schema.json).
The reference owns semantic reasoning; the schema only projects that answer for
validation. Do not start the root Better Harness workflow or another provider
runner:

```text
Read skills/better-harness/references/session-skill-pattern-discovery.md and use
only Pass 1 to analyze <discovery-packet.json>.
Project the answer through $defs.discoveryResult from
benchmark/session-evidence-jsonl/v1/skill-pattern.schema.json and write it to
<discovery.json>.
```

Validate and freeze that output before exposing any Skill, CodeFusion catalog, or
owner material. Then give the same reference and generated owner packet to a
fresh read-only IDE task for Phase 2:

```text
node scripts/session-evidence-eval.mjs skill-discovery-validate --packet <discovery-packet.json> --decision <discovery.json>
node scripts/session-evidence-eval.mjs skill-freeze --case <case-id> --packet <discovery-packet.json> --decision <discovery.json> --output <owner-packet.json>
node scripts/session-evidence-eval.mjs skill-packet-validate --packet <owner-packet.json>

Read skills/better-harness/references/session-skill-pattern-discovery.md and use
only Pass 2 to analyze <owner-packet.json>. Preserve the frozen patterns, project
the answer through $defs.result from the benchmark schema, and write it to
<owner-decision.json>.

node scripts/session-evidence-eval.mjs skill-result-validate --packet <owner-packet.json> --decision <owner-decision.json>
node scripts/session-evidence-eval.mjs skill-record --packet <owner-packet.json> --decision <owner-decision.json> --output <record.json>
```

`skill-freeze` creates the receipt from the exact discovery packet that Phase 1
received, then rejects case material whose Episode projection no longer matches
that receipt. The owner-packet validator recomputes both freeze hashes and rejects
changed Episodes or frozen semantics. Other validation checks privacy, evidence and
target membership, recurrence, and action-required fields. It does not grade
semantic correctness or require one exact oracle action.

The record is a privacy-safe receipt rather than a recommendation. It retains
packet/result and binding hashes, organic-versus-benchmark provenance, the
workflow and Episode bindings, replica/recurrence counts, and structured
candidate/action/target decisions without Episode or decision prose. The
evaluator command only writes this receipt; it does not admit it to a report.

Production admission calls `attachSkillPatternAnalysis()` with the current
report source, packet, and recommendation result. That function revalidates and rehashes
the inputs, requires the packet's workflow and Episode ids to exactly match a
generated workflow-demand lead, and writes the resulting record to the
generated `repositoryEvidence.skillPatternRecords` registry. Review input may
reference that registry but cannot author it. A finding uses structured
`ownerAction`; `expectedArtifact: Skill` or prompt prose alone means only an
existing-owner repair. Create/extend requires exactly one registry-backed
recommendation ref and one matching lead adjudication ref. Benchmark, non-organic,
replica-only, duplicate, cross-workflow, candidate-, action-, or target-mismatched
receipts remain evaluation evidence only.

## Packet contract

Phase 1 contains only sanitized Episodes, deterministic observations, replica
provenance, and Episode refs. Phase 2 adds the validated freeze receipt, actual
bounded capability instructions separated from catalog metadata, runtime
surface/discovery/mode evidence, explicit-use refs, bounded owner excerpts, and
omissions. A row without instructions or satisfied context remains `unknown`.
Neither phase may contain:

- `taskFamily` or another predicted intent label;
- a completed `workflowPattern`;
- `complete` or `partial` coverage conclusions;
- `owns`, `missing`, semantic similarity, expected action, or smallest owner;
- raw provider wrappers, hidden reasoning, tool bodies, stable ids, absolute
  paths, or secrets.

Capability content unavailable to the reviewer stays `unknown`; a filename or
configured presence cannot substitute for it.

## Evaluation

Use a fresh IDE task or a human reviewer to adjudicate intent fidelity, pattern
coherence, evidence traceability, recurrence honesty, capability-content fit,
smallest-owner selection, action proportionality, and uncertainty calibration.
Use `acceptable`, `acceptable-alternative`, `needs-revision`, `invalid`, or
`needs-human` rather than one exact semantic answer.

Metamorphic cases should vary wording, provider and project labels, Episode
order, replica count, irrelevant Skill names, semantically identical renamed
Skills, and missing validation/stop content. A robust analysis follows meaning
and actual capability content, not the perturbation.

Return advisory `create-skill` or `extend-skill` candidates to the Better
Harness lead. Only after lead reconciliation may a separately authorized route
continue through [Skill Discovery](../agent-customize/skill-discovery.md).
Return unresolved or non-Skill owner questions through
[Loop Discovery](../loop-engineering/loop-discovery.md).
