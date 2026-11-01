---
name: knowledge-plan
description: Steer the Repo Wiki / knowledge build before it runs — author notes, a page whitelist, per-page templates, preset templates and file-scope filters in `.cf/repowiki/wiki_plan.yaml`. Use when the user runs /knowledge-plan, wants to customise or intervene in wiki generation, asks to pin facts the model cannot infer, restrict which files/pages are included, or requires a fixed page outline.
---

# Pre-flight intervention via wiki_plan.yaml

`wiki_plan.yaml` (lives at `<project_root>/.cf/repowiki/wiki_plan.yaml`) lets
the project author steer the future wiki / knowledge build BEFORE it runs — via
authoring notes, a page whitelist, per-page templates, and file-scope filters.

> Path note: `<project_root>` is a placeholder for the absolute path of the
> current project. The path separator inside concrete file operations must
> follow the host OS convention (`/` on macOS/Linux, `\` on Windows). When
> reading or writing the file via native tools, always join the path using the
> platform's native separator. Forward slashes inside the YAML file itself
> (e.g. relative globs in `scope.include`) are fine — YAML consumers normalise
> them across platforms.

## Workflow when activated

1. **Inspect briefly with native file tools (NOT wiki_*/knowledge_*)**:
   list_dir on the project root + read_file on README / package.json /
   go.mod / pom.xml / etc. (whichever exist). Run reads in parallel. Always
   build paths with the OS-native separator.

2. **Read existing config first** — read_file the file at
   `<project_root>/.cf/repowiki/wiki_plan.yaml` (join with the native path
   separator on the current OS):
   - Not found → create from scratch.
   - Exists & additive intent → preserve all existing fields, append /
     merge only the new entry; prefer edit_file for surgical changes.
   - Exists & restructure intent → state changes explicitly, then overwrite.
   Never silently drop fields the user did not mention.

3. **Map intent → field**:
   - version pin / canonical fact / forbidden pattern → `repowiki.notes`
     (and usually `knowledgecard.notes` too for cross-pipeline consistency)
   - module split / merge / boundaries → `knowledgecard.notes`
   - required page outline → `repowiki.documents` (whitelist mode)
   - per-page section format → `repowiki.documents[*].template`
   - **preset wiki template (global)** → `repowiki.template` (see below)
   - file range control → `scope.include` / `scope.exclude`

4. **Write & summarise** — write_file (or edit_file) to the file at
   `<project_root>/.cf/repowiki/wiki_plan.yaml`, again using the OS-native
   path separator. Then tell the user (in their language) which intents map
   to which fields, what changed, and that the file only takes effect after
   the wiki / knowledge build is re-run.

## Schema reference (top-level keys, all optional except version)

```yaml
version: 1                     # always 1
scope:                         # .gitignore syntax; layered ON TOP of .qoderignore
  include: []                  # whitelist; empty = no whitelist
  exclude: []                  # blacklist
repowiki:
  template: ""                 # OPTIONAL preset template name; one of:
                               #   architecture          — code/architecture analysis
                               #   product_requirement   — product PRD
                               # Empty = no preset (LLM organises freely).
                               # Priority: documents[*].template > repowiki.template
  notes: [{text, author?}]     # strong priors fed into wiki planner
  documents: [{title, goal, parent?, hints?, template?}]
                               # whitelist; sets strict-shape mode for the wiki build
                               # parent=="" = top-level; 1 nesting level only
                               # template = mandatory H2-section skeleton (markdown)
knowledgecard:
  notes: [{text, author?}]     # strong priors fed into knowledge planner
```

Hard caps: repowiki.notes & knowledgecard.notes ≤ 50 entries each;
single note.text ≤ 10000 chars; repowiki.documents ≤ 500 total /
≤ 120 top-level / ≤ 80 children per parent; single documents[*].hints
& documents[*].template ≤ 5000 chars each (character-counted, incl.
CJK — longer fields are silently truncated at load time).

## Preset template recognition (`repowiki.template`)

When the user references one of these presets (any language, loose wording),
set `repowiki.template` accordingly. Only two values are accepted; matching
notes & section skeletons will be automatically applied in the build's output
language — do NOT duplicate them into `repowiki.notes`.

| Preset | Triggers (zh / en) |
|--------|-------------------|
| `architecture` | 架构 / 架构设计 / 代码架构 / 技术架构 / architecture / code architecture / design doc |
| `product_requirement` | 产品需求 / 需求文档 / 产品文档 / PRD / product requirement / product spec |

Priority: `documents[*].template` > `repowiki.template`. Unknown values are
ignored — if intent is ambiguous, ask instead of guess.

## Authoring rules (concise)

- Notes: 1–2 short sentences each, written as instructions to the LLM.
  Pin facts the LLM cannot infer from code (versions, ownership, canonical
  conventions, forbidden patterns). Skip vague compliments and obvious facts.
- Pages: use sparingly — empty = LLM auto-plans (right default for most
  projects). Each title must map to a real coherent code/doc area.
- Titles & note text in the project's documentation language
  (zh-CN / en-US / …); keys / category ids stay ASCII.
- Scope: leave both empty when boundaries are unclear; common patterns
  include `["src/**"]`, `["node_modules/**", "dist/**"]`, `["**/*.pb.go"]`.
  Glob patterns inside YAML always use forward slashes regardless of host OS.

## Guardrails

- Never reference paths you have not verified exist.
- Never set scope so tight it excludes the main source tree.
- Never put real secrets / tokens / PII into note text.
- Never invent a non-version-1 schema.
- When modifying existing yaml, never silently drop unrelated fields.
- When constructing absolute file paths for read/write operations, always use
  the host OS's native path separator; do not hardcode `/` on Windows.
