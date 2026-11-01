# Sessions Diagnostics

Analyze session evidence as a local engineering workflow. Keep claims tied to
files, logs, transcripts, metrics, or observed behavior.

## Bundled Tools

Use `scripts/session-analysis.mjs` for structured session inventory before manual
JSONL inspection. Resolve `<node>` through
`../tool-runtimes/node-runtime-discovery.md` if PATH `node` is unavailable or
fails validation:

```bash
# Discover evidence roots for a workspace
<node> scripts/session-analysis.mjs sources --platform <qoder|codex> --workspace /path/to/repo

# Session list with event counts and time range
<node> scripts/session-analysis.mjs facets --platform <qoder|codex> --workspace /path/to/repo --limit 20

# Compact insight cards and action candidates
<node> scripts/session-analysis.mjs insights --platform <qoder|codex> --workspace /path/to/repo --limit 20

# Read single session events
<node> scripts/session-analysis.mjs show --platform <qoder|codex> --workspace /path/to/repo --session-id <id> --include-events

# Diagnose the facts admission funnel and resolve candidate refs to local sessions
<node> scripts/session-analysis.mjs facts --platform <qoder|codex> --workspace /path/to/repo --selection all-eligible --limit 5 --debug --output /tmp/session-facts-debug.json

# Expand one debug locator with normalized commands and user text
<node> scripts/session-analysis.mjs show --platform <qoder|codex> --workspace /path/to/repo --session-id <id> --include-events --include-command-text --include-user-text
```

`facts --debug` is an operator-only diagnostic route. It exposes raw session
ids under `debug.locators`, so never send that envelope to the Session Evidence
agent or copy it into a report. Compare `admission`, `omitted`,
`populationCoverage`, `observationCoverage`, and `diagnosticFlags` before
opening only the candidate sessions needed to explain a surprising aggregate.
Command and user text flags are also local-only and must not be used for broad
transcript dumps.

Supported platforms: `qoder`, `codex`. Do not invent unsupported platform names.
Always pass the absolute target workspace and load the matching Platform Notes
before interpreting source roots or workspace bindings.
Fall back to direct JSONL reads when the script is unavailable or you need
user-prompt text extraction beyond event structure.

Treat any heuristic match as a candidate until the
important findings are manually checked.

## Coding Agent Session Research

Use this flow when platform project or user assets, Session Insights,
validation habits, workflow friction, or repeated coding-agent workflows are
in scope:

1. Resolve the absolute target workspace and list the platforms in scope.
2. Run `session-analysis.mjs sources` for each analyzer-supported platform in
   scope before declaring roots absent.
3. Use the selected Platform Notes to confirm which discovered roots and
   records bind to the target workspace.
4. Run `facets` with the same `--platform` and `--workspace` when `sources`
   reports enabled roots or sessions; otherwise record the source-probe result
   as the no-session boundary.
5. Run `insights` with the same scope when a user-facing report, recommendation,
   or review action needs the most important session signals. Use `facets` as
   aggregate evidence and `insights` as the compact card/action input.
   `insights.keySignals.longSessions` separates active long sessions from
   wall-span-only idle/resume sessions.
6. Use `show --include-events` only for bounded samples that support important,
   surprising, or high-impact claims.
7. For important aggregate items, expand the counter before turning it into a
   report claim. Use `facets.topHookCommands` or `insights.keySignals.topHookCommands`
   to identify hook command/script targets such as
   `PostToolUse -> node hooks/post-tool.mjs`; if no command is present in the
   event data, compare with configured hook inventory and label those commands
   as configured candidates instead of observed script execution.
8. For Goal, Plan, and Spec workflow evidence, use `planningSignals` from
   `facets` or `insights`. `workspace` signals prove current-project observed
   behavior; `user-global` signals prove user/global capability only. Static
   specification directories or goal database files are project-binding or
   state evidence, not observed Goal/Plan use unless matching session evidence
   exists.
9. Join static assets and session behavior explicitly: configured Rules, Skills,
   MCP, hooks, agents, or plugins are presence/content evidence; observed tool
   calls, hook events, permission decisions, validation commands, and errors are
   execution evidence.
10. Treat `long-active-review` as an outcome-review lead. Classify task family,
    outcome, and friction before considering a durable owner. Do not recommend delegation from wall-span-only sessions.
11. Report one platform at a time unless the user asks for comparison. If both
    CodeFusion and Codex are in scope, keep separate evidence ledgers and only compare
    after each platform has its own source probe and bounded facets.
12. Route a reviewed repeated or schedulable candidate to
    `../loop-engineering/loop-discovery.md`. Route an authorized Skill decision
    to `../agent-customize/skill-discovery.md`. When maintainers need to test and
    record the AI handoff itself, use
    [Session-derived Skill Evaluation](session-skill-evaluation.md).

## Evidence Boundary

- Workspace context: guidance files, project manifests, validation commands,
  local runtime config, rules or policies, MCP config, local skills, plugins,
  agents, hooks, and automations.
- Runtime home: selected-platform settings, audit logs, run manifests, session
  indexes, skills, plugin state, and caches only when the requested scope makes
  user-home evidence relevant.
- Session traces: event timestamps, tool calls, permission decisions, hook
  events, validation commands, edit events, model attribution, errors, and
  transcript coverage gaps.
- Generated reports: source evidence JSON, usage JSON, bounded analysis packets,
  review packets, final reports, and quality-check output.
- For installed or global assets, run
  `scripts/agent-customize/cli.mjs inventory --provider <cursor|qoder|codex>`
  or the `scripts/coding-agent-practices/inventory.mjs` wrapper, and treat its
  output as configured asset inventory, not session behavior.

## Output Rules

- For session behavior, reconstruct the timeline from audit events before
  drawing conclusions about validation, tools, permissions, or outcomes.
- Manually inspect important evidence; do not rely on aggregate counters alone for claims.
- Separate confirmed problems, likely risks, healthy checks, and coverage gaps.
- Recommend the smallest useful fix first: close context and validation gaps
  before broader automation, policy, or model changes.
- Do not infer runtime behavior from static files alone.
- Do not merge tools into one story unless comparison is explicitly requested.
- Do not treat loaded skill text as proof that a skill/tool was invoked.
- Do not recommend broad automation before fixing missing context or validation
  commands.
- Do not print raw secrets, tokens, private keys, prompts, or `.env` contents.

## Platform Notes

Load only the selected platform note. These sections own source roots,
workspace matching, host-local state, and platform-native follow-up routes.

### CodeFusion

For CodeFusion, always pass the current absolute project path as `--workspace`. The
analyzer computes the workspace slug by replacing path separators with `-`, so
`/Users/example/workspace/better-harness` maps to
`~/.cf/projects/-Users-example-workspace-better-harness/**/*.jsonl` plus matching
CodeFusion audit, run, log, state, transcript, and optional cache roots. Do not treat
unscoped files under `~/.cf/projects` as current-project evidence.

CodeFusion is the primary runtime for CodeFusion reports. Inspect relevant sources such
as `~/.cf/settings.json`, `~/.cf/audit/audit.jsonl`,
`~/.cf/logs/runs/*/manifest.json`,
`~/.cf/plugins/installed_plugins*.json`, and
`~/.cf/plugins/cache/**/SKILL.md` only when user-home scope is authorized.
Connect those files back to the selected workspace sessions instead of treating
global counters as workspace evidence.

Static locations such as `.cf/specs` are project-binding or state evidence,
not observed Goal, Plan, or Spec use without matching session evidence. Route
CodeFusion Rule, Hook, Skill, Custom Agent, or MCP tuning through
`../agent-customize/platforms/qoder.md`.

### Codex

For Codex, the analyzer probes `~/.codex/audit-logs`, `~/.codex/audit`,
`~/.codex/sessions`, `~/.codex/session_index.jsonl`, `~/.codex/history.jsonl`,
and optional archived sessions. Keep Codex evidence scoped by workspace matches
inside those records; do not treat all `~/.codex` activity as current-project
evidence.

Inspect Codex audit logs, sessions, indexes, history, skills, and plugin/cache
equivalents only when relevant to the requested scope. Static locations such as
`.codex/specs` remain project-binding or state evidence, not observed Goal,
Plan, or Spec use without matching session evidence. Load
`../agent-customize/platforms/codex.md` for Codex-native follow-up guidance.
