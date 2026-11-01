# Better Harness

> Better Harness = Engineering Best Practices × Coding Agent Governance × Self-improving AI Delivery.

Better Harness is the package, plugin, CLI, and report-artifact layer for the
Better Harness methodology. It helps teams build a system where AI can safely
understand, change, review, report, and improve software over time.

- Project Harness. Prepares the repository as an AI-ready engineering environment by wiring together project context,
  structure, commands, history, sessions, and executable signals.
- Engineering Fluency. Translates complex engineering signals into a shared language for developers, architects,
  leaders, and agents, making health, readiness, risk, and delivery quality easier to understand.
- Change Confidence. Evaluates each AI-generated change through blast radius, sensitive paths, change size, commit
  patterns, and validation signals to decide whether it is safe to land.
- Agent Guardrails. Defines the behavioral boundaries for coding agents, keeping their actions safe, scoped,
  permission-aware, and aligned with team engineering standards.
- Action Pathways. Turns engineering insights into clear, sequenced, and reviewable paths for improvement, helping teams
  decide what to automate, test, split, govern, or review next.
- Adaptive Engineering Loop. Closes the loop across sessions, hooks, reviews, reports, memory, and outcomes,
  continuously tuning recommendations, rules, and agent behavior.

## Quickstart

Get a first readiness report in about five minutes — two steps:

```bash
# 1. Prepare static evidence and print the handoff
better-harness report                # installed host
node scripts/better-harness.mjs report   # from a clone of this repo

# 2. In Qoder (or any coding agent in this repo), run the skill
/better-harness
```

`better-harness report` gathers static evidence (project shape, agent
instructions, dependency governance, working-tree drift) and points at the next
step. It does not write the report itself: the `/better-harness` skill reads that
evidence and writes findings-backed Qoder Canvas artifacts to
`.qoder/better-harness/<date>/<time>-<target>/`:

- `findings.json`
- `report.canvas.tsx`

The legacy `qoder-harness` bin remains a compatibility entrypoint while the
visible product surface moves to Better Harness.

New to the concepts? Start with [docs/concepts.md](docs/concepts.md). You only
need the five project capabilities and the report to begin; everything else is
progressive detail. Unsure about a term (harness, capability, blast radius,
loop)?

## Packaging

`@ali/better-harness` is the lightweight build-time package for IDE hosts.
The npm tarball contains the CLI, skills, hooks, models, references, and
templates, but not tests, dev preview tools, or `node_modules`.

Use `npm run bundle:zip -- --out <path>` from an installed package to create the self-contained runtime bundle for an IDE
installer. The zip includes the Better Harness runtime files plus vendored
minimal `@vscode/tree-sitter-wasm` and `esbuild-wasm` runtimes under `vendor/`,
so blast-radius and Canvas transforms work after extraction without
`npm install` and without a `node_modules/` directory in the zip.
