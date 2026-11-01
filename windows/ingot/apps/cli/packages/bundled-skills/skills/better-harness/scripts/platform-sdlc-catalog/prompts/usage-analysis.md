# Platform SDLC Usage Analysis Prompt

You are reviewing one or more
`better-harness.platform-sdlc-usage` JSON documents. Analyze only the supplied
documents. Do not open raw sessions, system prompts, tool output, private paths,
or provider databases.

## Evidence semantics

- Catalog presence is a maintained platform snapshot. It does not prove that a
  capability was advertised or available in every historical session.
- `explicit-skill-name-match` proves that the session invoked a Skill with the
  same name. It does not prove deliberate user selection, or whether a built-in,
  configured, plugin, or shadowing Skill owned that name.
- `explicit-user-command` proves that a retained user message began with the
  catalogued slash command.
- `not-observed` means no matching explicit activation was retained in the
  analyzed scope. It never means "never used."
- `uncataloguedObservedSkills` are observed names outside this partial catalog.
  They are candidates for provenance review, not automatically missing built-ins
  and not automatically recommendations to create, extend, disable, or delete a
  Skill.
- Prompt advertisement, ordinary prose mentions, assistant reasoning, and
  `tool_result` echoes are not usage.
- Activation count does not prove task relevance, correct execution, validation,
  delivery, learning, or effectiveness.
- `stageMappings` projects observed capability names through the maintained
  catalog. It does not prove that the activation happened during that task stage.

## Analysis procedure

1. Verify that every document has the expected `kind`, platform, scope, session
   boundary, catalog completeness, and evidence boundary. State any mismatch or
   missing field before interpreting counts.
2. Keep these comparisons separate:
   - same workspace, 30-day history versus all retained history;
   - current workspace versus all-projects provider history.
3. Match capabilities by `id`, with `name` and `kind` as readable labels. Report
   exact activation counts; do not manufacture coverage percentages, maturity
   scores, or effectiveness ratings.
4. Identify capabilities missed by the 30-day window but present in the same
   workspace's retained history. This is window-recall evidence, not evidence of
   current use.
5. Summarize all-projects matches separately. Show the catalogued SDLC stage
   mappings for observed capabilities, while saying that these are mappings, not
   event-time task-stage attribution. A capability mapped to multiple stages is
   one observed capability, not multiple activations per stage.
6. List only the most relevant uncatalogued Skill names and label their provenance
   unresolved. Do not turn inventory size or invocation count into a finding.
7. Answer the following questions explicitly:
   - Can the data prove that a session used the capability?
   - Can it prove that the user deliberately selected it?
   - Can it reconstruct per-session system-prompt availability?
   - Does all retained history change the 30-day conclusion?
8. Recommend another data change only when a stated question cannot be answered
   from this contract. Keep the recommendation at evidence-collection level; do
   not propose product or Skill mutation without task-linked outcome evidence.

## Required output

Write a concise Chinese Markdown report with exactly these sections:

1. `## 结论`
2. `## 对照表`
3. `## 能回答与不能回答`
4. `## 下一步`

The comparison section must use one Markdown table with these columns:
`范围`, `会话数`, `显式匹配`, `Catalog 阶段映射`, and `相对 30 天新增`.
Keep exact counts and scope labels, omit raw prompts, commands, session
identifiers, private paths, and workspace paths, and stay under 900 Chinese
characters where practical.
