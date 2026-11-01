---
name: repo-wiki
description: Generate and maintain the Repo Wiki for the current workspace — a per-module knowledge base written to .cf/repowiki/<language>/ with overview, architecture, tech stack and coding conventions for the project and for every top-level module. It also writes the IDE-compatible wiki.json so the CodeFusion IDE Repo Wiki view and `cf wiki` read the same pages. Use when the user runs /repo-wiki, says "repo wiki", "document this repository", "create project knowledge", "explain the codebase", "refresh the wiki", or after a large refactor.
---

# Repo Wiki

Build the real Repo Wiki: project pages + one knowledge folder per top-level module, all
plain Markdown, plus the IDE manifest. It stays readable by the CodeFusion IDE view and
`cf wiki`.

## What is actually known about Qoder (verified 2026-10-28)

Extracted from the installed Qoder 1.18.0 (`resources/app`, unpacked) and its own cache —
see `fusion/review-tracking/QODER_REPO_WIKI_RE.md` for file paths and quoted strings:

- Qoder keeps its cache at `%APPDATA%\Qoder\SharedClientCache\repowiki\` as
  `knowledge.db` plus `wiki_snapshots/<project-hash>/<lang>/{metadata.json, mtree.json, files/**}`.
- The cache key is `<project>#wiki#<branch>#wiki#<lang>`; a non-git project uses the
  sentinel branch `Q0DeR-MaG1C-BrAnCh-Fo2-NoN-GiT-Or-No-C0MmIt`.
- Ingestion caps are `maxFileNum 250000`, `maxIndexingFileNum 100000`, `maxDepth 100`,
  `maxDirFileNum 10000`, with simhash; the ignore file is `.qoderignore`.
- The message surface is `wiki/startGenerate`, `cancelGenerate`, `pauseGenerate`,
  `getStatus`, `notifyStatus`, `getContent`, `getCatalogs`, `changeLanguage`, `deleteIndex`,
  `regenerate`, `regenerateContent`, `update`, `updateConfig`, `synchronize`, `fixMermaid`.
- `.qoder/repowiki` is the **import/export sync directory**, and generation is
  credit-gated on Qoder's backend. The page-level Markdown layout Qoder produces was
  **not observable** on this machine (no completed generation exists), so nothing below
  claims to copy it.

CodeFusion therefore defines its own page layout (next section) while matching Qoder's
ingestion caps, ignore file, and workspace-key shape.

## Output layout (write exactly this)

```
.cf/repowiki/<language>/                 # language defaults to en
  wiki.json                              # IDE manifest (schema below)
  _index.yaml                            # module index (schema below)
  overview.md                            # project overview
  architecture.md                        # project architecture
  tech-stack.md                          # project tech stack
  conventions.md                         # project coding conventions
  modules/<module-slug>/
    _module.yaml
    overview.md
    architecture_design.md
    tech_stack.md
    coding_conventions.md
```

- `module-slug` = kebab-case of the top-level path (`packages/ui` → `packages-ui`).
- Cap at 12 modules, ordered by file count descending (matches the IDE planner).
- Never write outside the workspace; never touch `node_modules`, `.git`, `dist`, `build`,
  `out`, `coverage`, `.next`, `.turbo`, `vendor`, `.venv`, `__pycache__`, `target`, `cf-old`.

## Inventory (bounded, same rules as the IDE scanner)

1. Walk the workspace from the root, depth ≤ 100, ≤ 250 000 entries visited, ≤ 100 000
   indexed files, ≤ 10 000 entries per directory (Qoder's shipped mtree caps).
2. Honour `.qoderignore` at the workspace root (comments, `dir/`, `*` globs) in addition to
   the built-in skip lists.
3. Skip binary/media extensions, lockfiles (`package-lock.json`, `pnpm-lock.yaml`,
   `yarn.lock`, `Cargo.lock`, `poetry.lock`, `uv.lock`, …) and files > 60 KB for excerpts.
4. Record per file: relative path, size, language by extension.
5. Top-level module = first path segment; root files belong to `(root)` and are not a module.
6. Pick excerpts: every manifest/doc (`package.json`, `pyproject.toml`, `Cargo.toml`,
   `go.mod`, `pom.xml`, `build.gradle*`, `CMakeLists.txt`, `Makefile`, `Dockerfile`,
   `docker-compose*`, `tsconfig.json`, `vite.config.*`, `next.config.*`, `mise.toml`,
   `.env.example`, `README*`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `AGENTS.md`,
   `CLAUDE.md`, `DESIGN.md`) plus up to 3 shallow, 200 B–60 KB source files per module.
   Read ≤ 60 excerpts, ≤ 6 KB each, ≤ 90 KB total.
7. `fingerprint` = sha256 over sorted `relativePath + "\0" + size` lines.

## Page content rules (evidence only)

Every page: one `#` heading, GitHub-flavoured Markdown, inline code paths, no surrounding
code fence, no preamble. State only what the evidence shows; omit unsupported claims.

Project pages:
- `overview.md` — what it is, problem solved, main capabilities tied to files, how to run.
- `architecture.md` — modules/layers, responsibilities, data/control flow, entry points
  (CLI/server/UI bootstrap), extension points and safe boundaries.
- `tech-stack.md` — languages, frameworks, runtimes, build/test/lint tooling, version pins.
- `conventions.md` — naming, layout, error handling, testing, comment/doc conventions.

Per-module pages (`modules/<slug>/`):
- `overview.md` — responsibility of the module and how it fits the whole.
- `architecture_design.md` — key files, internal structure, dependencies, extension points.
- `tech_stack.md` — languages/frameworks/tools used inside this module.
- `coding_conventions.md` — patterns and rules observed in this module's code.

`_module.yaml`:

```yaml
name: <module display name>
path: <module path>
slug: modules/<module-slug>
file_count: <int>
languages: [TypeScript, …]
entry_points: [src/index.ts, …]
summary: <one sentence>
```

`_index.yaml`:

```yaml
version: 1
language: en
generated_at: <ISO-8601>
modules:
  - name: <module display name>
    path: <module path>
    slug: modules/<module-slug>
    page: modules/<module-slug>/overview.md
    file_count: <int>
```

## IDE manifest (`wiki.json`)

```json
{
  "version": 1,
  "language": "en",
  "branch": "<git branch or no-git>",
  "fingerprint": "<sha256>",
  "status": "ready",
  "generatedAt": 1730000000000,
  "durationMs": 12000,
  "stats": {
    "fileCount": 123,
    "totalBytes": 456789,
    "languages": [{ "language": "TypeScript", "files": 90 }],
    "generatedAt": 1730000000000,
    "durationMs": 12000,
    "model": { "providerId": "…", "modelId": "…" }
  },
  "pages": [
    { "slug": "overview", "title": "Project Overview", "kind": "overview", "order": 0, "sourcePaths": ["README.md"] },
    { "slug": "architecture", "title": "Architecture", "kind": "architecture", "order": 1, "sourcePaths": [] },
    { "slug": "tech-stack", "title": "Tech Stack", "kind": "tech-stack", "order": 2, "sourcePaths": [] },
    { "slug": "conventions", "title": "Coding Conventions", "kind": "conventions", "order": 3, "sourcePaths": [] },
    { "slug": "modules/<slug>/overview", "title": "Module: <name>", "kind": "module", "order": 10, "modulePath": "<path>", "sourcePaths": [] },
    { "slug": "modules/<slug>/architecture_design", "title": "Module: <name> — Architecture", "kind": "module", "order": 11, "modulePath": "<path>", "sourcePaths": [] },
    { "slug": "modules/<slug>/tech_stack", "title": "Module: <name> — Tech Stack", "kind": "module", "order": 12, "modulePath": "<path>", "sourcePaths": [] },
    { "slug": "modules/<slug>/coding_conventions", "title": "Module: <name> — Conventions", "kind": "module", "order": 13, "modulePath": "<path>", "sourcePaths": [] }
  ]
}
```

`<slug>.md` is resolved relative to the wiki directory, so nested slugs map to the nested
files above. The IDE view and `cf wiki show <slug>` read these paths directly.

## Generation

- Use the session's current model. There is no plan gate, no entitlement check and no
  separate wiki quota — every configured model (including local providers) is usable.
- Put the bounded repository digest (inventory + module table + excerpts) in the prompt once
  and ask for one page at a time; keep each request under ~90 KB.
- Write pages as they are produced, then write `_index.yaml`, `_module.yaml` files and
  `wiki.json` last. If a page fails, keep the previous file and record it in the final report.

## Refresh behaviour

- Read existing `wiki.json`; if `fingerprint` is unchanged, report "wiki is up to date".
- Otherwise regenerate only pages whose module files changed, refresh `_index.yaml`, update
  `wiki.json` (`branch`, `generatedAt`, `stats`, `pages`).
- Branch change alone: update `branch` + `generatedAt`, keep content.

## Finish

Report: wiki directory, module count, page count, model used, and the command to read it
(`cf wiki list`, `cf wiki show overview`). Offer to open the IDE Repo Wiki view.
