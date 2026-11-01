# Qoder Platform SDLC Capability Catalog

This Markdown table is the maintained catalog. Keep product identity separate
from provenance: Qoder is the platform and the product runtime repository is a
partial source. The packaged runtime reads this snapshot; a sibling source
checkout is only an optional maintainer input for drift checks.

## Platform

| Field | Value |
| --- | --- |
| schema_version | 1 |
| platform_id | qoder |
| display_name | Qoder |
| lifecycle_model | qoder-sdlc-v1 |
| source_completeness | partial |
| source_gaps | qodercli-internal skills, runtime system-prompt capabilities |
| canonical_phases | plan, design, develop, test, deploy, operate |

## Sources

| Source ID | Type | Role | Revision | Coverage | Maintainer input |
| --- | --- | --- | --- | --- | --- |
| qoder-product-runtime | repository | product-runtime | 4931e043c423acb4e8e3e631f5749e44b0e30fd7 | partial | sibling checkout supplied explicitly to the CLI |

## SDLC stages

These labels are the reviewed Qoder profile used by Better Harness; they are
not claimed as product UI terminology. Canonical phases exist only for
cross-platform comparison.

| Stage ID | Label | Canonical phase |
| --- | --- | --- |
| qoder-plan | Plan and scope | plan |
| qoder-design | Specify and design | design |
| qoder-build | Agent-assisted implementation | develop |
| qoder-verify | Test and verify | test |
| qoder-deliver | Review and deliver | deploy |
| qoder-operate | Operate and learn | operate |

## Capabilities

No row enters pre-semantic workflow diagnostics. After an Episode-only pattern
is frozen, rows may enter the lead's owner comparison as routing metadata. Every row,
including `default`, needs separately supplied instructions and current runtime
evidence before a recommendation; catalog presence never proves availability,
use, coverage, or effectiveness.

| ID | Name | Kind | Source | Availability | Modes | Stage refs | Disciplines | Workflow intents | Recommendation | Source path | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| qoder-canvas | canvas | skill | qoder-product-runtime | built-in | chat, quest | qoder-design | design, visualization | - | runtime-context | chat/agents/tool/skill/builtin_skills/canvas/SKILL.md | Embedded global Skill; slash-command invocation only. |
| qoder-create-skill-ui | create-skill-ui | skill | qoder-product-runtime | mode-restricted | quest | qoder-design, qoder-build | design, implementation | - | runtime-context | chat/agents/tool/skill/builtin_skills/create-skill-ui/SKILL.md | Command visibility is Quest-only. |
| qoder-create-skill | create-skill | skill | qoder-product-runtime | built-in | chat, quest | qoder-operate | learning | - | runtime-context | chat/agents/tool/skill/builtin_skills/create-skill/SKILL.md | Creates a durable Skill only after the reuse decision is supported. |
| qoder-create-subagent | create-subagent | skill | qoder-product-runtime | built-in | chat, quest | qoder-build | orchestration, implementation | - | runtime-context | chat/agents/tool/skill/builtin_skills/create-subagent/SKILL.md | Creates a reusable isolated specialist. |
| qoder-schedule | schedule | skill | qoder-product-runtime | mode-restricted | quest | qoder-operate | operations | - | runtime-context | chat/agents/tool/skill/builtin_skills/schedule/SKILL.md | Runtime also requires the session-scoped schedule MCP. |
| qoder-vercel-deploy | vercel-deploy | skill | qoder-product-runtime | built-in | chat, quest | qoder-deliver | release, verification | release-delivery | runtime-context | chat/agents/tool/skill/builtin_skills/vercel-deploy/SKILL.md | Recommend only for a matching Vercel web-delivery path. |
| qoder-front-design | front-design | skill | qoder-product-runtime | agent-private | coding-agent | qoder-design, qoder-build | design, implementation | - | runtime-context | chat/agents/tool/skill/builtin_skills/builtin_for_agent_front-design/SKILL.md | Loaded only by the Coding Agent and excluded from the global Skill pool. |
| qoder-wiki-plan-gen | wiki-plan-gen | skill | qoder-product-runtime | agent-private | knowledge | qoder-plan, qoder-design | planning, specification | planning, specification-preparation | runtime-context | chat/agents/tool/skill/builtin_skills/builtin_for_agent_wiki-plan-gen/SKILL.md | Exposed only in an eligible knowledge context and behind subsystem readiness. |
| qoder-browser | /browser | command | qoder-product-runtime | built-in | chat, quest | qoder-verify, qoder-deliver, qoder-operate | testing, verification | testing-verification | runtime-context | extension/slashcommand/slash_command_service.go | Count toward verification only when browser use is task-linked and produces acceptance evidence. |
| qoder-computer-use | /computer-use | command | qoder-product-runtime | feature-gated | chat, quest | qoder-verify, qoder-deliver, qoder-operate | testing, verification | testing-verification | runtime-context | extension/slashcommand/computer_use_command.go | Availability depends on OS support, installed binaries, plugin state, and run mode. |
| qoder-ultra-review | /ultra-review | command | qoder-product-runtime | feature-gated | chat, quest | qoder-verify, qoder-deliver | review, verification | review-acceptance | default | extension/slashcommand/ultra_review_command.go | Preserves the current default Qoder review trial; the product may expose code-review when Ultra Review is disabled. |

## Consistency issues

| Issue ID | Severity | Source | Summary |
| --- | --- | --- | --- |
| qoder-schedule-visibility-drift | warning | qoder-product-runtime | The registry declares schedule for both modes while runtime filtering and tests require Quest-only visibility. |
| qoder-source-coverage-partial | info | qoder-product-runtime | The source notes that some qodercli-internal Skills are outside its command registry, so this catalog is not a complete Qoder inventory. |

## Workspace overlay boundary

Project files under `.qoder/skills/*` are Qoder workspace configuration. They
belong in configured Skill inventory and session activation evidence, not in
the product built-in capability rows above.
