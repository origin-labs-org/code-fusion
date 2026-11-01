# Added skills provenance

Skills added to `payloads/skills/` on 2026-11-01, copied verbatim from extracted
source archives. No content was rewritten; only directory placement changed.

Frontmatter (`name:` / `description:`) is left intact â€” the harness loads skills from
that frontmatter, so renaming directories does not require editing SKILL.md.

## Source 1 â€” deepseek-stack

- Origin: `github.com/aicodeking/deepseek-stack` (archive `extras/deepseek-stack-main.zip`)
- Extracted at: `.extract-tmp/ds1/deepseek-stack-main/skills/`
- 29 skill dirs, 30 files (ds-watch-pr carries `scripts/watch_pr.py` alongside SKILL.md)

| Destination | Skill dir | Files | Main file | sha256 (16) |
|---|---|---|---|---|
| payloads/skills | ds-adopt | 1 | SKILL.md | 4741f6ace8913575 |
| payloads/skills | ds-best-of-n | 1 | SKILL.md | 71ec135619a47cb1 |
| payloads/skills | ds-blast-radius | 1 | SKILL.md | 7c0ab0a57c0499c0 |
| payloads/skills | ds-blueprint | 1 | SKILL.md | da914d23c04e2272 |
| payloads/skills | ds-catchup | 1 | SKILL.md | 987ade6b3472db17 |
| payloads/skills | ds-context-reset | 1 | SKILL.md | 4192f7c621732a9b |
| payloads/skills | ds-design | 1 | SKILL.md | 5016916fdd9f126c |
| payloads/skills | ds-design-audit | 1 | SKILL.md | ad5bcad4d2cfec4d |
| payloads/skills | ds-explain | 1 | SKILL.md | 5ddc38a1e035c4ae |
| payloads/skills | ds-help | 1 | SKILL.md | 6fe3056bafb666fa |
| payloads/skills | ds-jury | 1 | SKILL.md | 94b1aa7cd86d77cc |
| payloads/skills | ds-ledger | 1 | SKILL.md | 5cd2966fb5ada4bd |
| payloads/skills | ds-lessons | 1 | SKILL.md | 1fe5f64dfa18b204 |
| payloads/skills | ds-mode | 1 | SKILL.md | 7de3fb5064c83e01 |
| payloads/skills | ds-plan-loop | 1 | SKILL.md | 3b794d5548b348ab |
| payloads/skills | ds-pr | 1 | SKILL.md | ef3218b8e4ea034b |
| payloads/skills | ds-pr-comments | 1 | SKILL.md | c84c00bb32f7335a |
| payloads/skills | ds-principles | 1 | SKILL.md | bcab50d965d79b48 |
| payloads/skills | ds-ready | 1 | SKILL.md | 5cdae5791c2004c7 |
| payloads/skills | ds-review-loop | 1 | SKILL.md | 909be1a9ff274350 |
| payloads/skills | ds-revive | 1 | SKILL.md | c75659930c8837ae |
| payloads/skills | ds-sharpen | 1 | SKILL.md | 17634d07001b9f54 |
| payloads/skills | ds-ship | 1 | SKILL.md | 7cd03e35c9ea0f6d |
| payloads/skills | ds-swarm | 1 | SKILL.md | e769dbdd3ade3921 |
| payloads/skills | ds-tdd | 1 | SKILL.md | 2bd4b60131ed124b |
| payloads/skills | ds-unslop | 1 | SKILL.md | 418e67f6234c4d0d |
| payloads/skills | ds-unstick | 1 | SKILL.md | a29a2aabdca7069d |
| payloads/skills | ds-verify-loop | 1 | SKILL.md | 89be04f924a99d3e |
| payloads/skills | ds-watch-pr | 2 | SKILL.md | fb2cfee400331715 |

## Source 2 â€” hallmark

- Origin: `github.com/Nutlope/hallmark` (archive `extras/hallmark-main.zip`)
- Extracted at: `.extract-tmp/hm1/hallmark-main/skills/hallmark/`
- 1 skill dir, 183 files (SKILL.md + 50 themes, genre/macrostructure references, scripts)

| Destination | Skill dir | Files | Main file | sha256 (16) |
|---|---|---|---|---|
| payloads/skills | hallmark | 183 | SKILL.md | 25a1ff92d925b238 |

## Labels (not vendor-official)

These skill sets are community/RE (reverse-engineering) work, **not** official vendor
support. `ds-*` skills are third-party agent-loop recipes referencing the DeepSeek
working style; they are not authored or endorsed by DeepSeek. `hallmark` is a
third-party design skill, not an Anthropic product. No skill here claims official
vendor support.

## Naming decision

The `ds-` prefix is kept as-is. Reasons:
1. Frontmatter `name:` must stay intact for harness loading, so directory and
   frontmatter names agree either way â€” no benefit from renaming.
2. The `ds-` prefix groups the 29 skills as one coherent working-style stack
   (they cross-reference each other by name, e.g. ds-plan-loop â†’ ds-verify-loop).
3. Renaming would break those internal cross-references and the source provenance.

