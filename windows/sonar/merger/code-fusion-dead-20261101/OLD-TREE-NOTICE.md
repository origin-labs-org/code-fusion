# OLD TREE — pre-restructure CodeFusion (read-only reference)

This folder is **a complete copy of the CodeFusion source tree as it was before the
rebrand/restructure**. It is kept as a diff reference for `master` and is **not** part of
the live repository.

## What is in here

| Part | Contents |
|---|---|
| Source tree | `apps/`, `packages/`, `examples/`, `skills/`, `vendor/`, `website/`, `native/`, `python/`, `archive/`, `docs/`, `scripts/`, `patches/` — the full pre-restructure layout |
| Installed dependencies | `node_modules/` — ~1.28 GB of the old lockfile's tree |
| Build output | `apps/web/dist/` (built web client), `.cf-build/` (client build environment), `scripts/release/` |
| Runtime leftovers | `.sessions/`, `tmp/`, `.tmp-*.log` |
| Old tooling config | `package.json` (`code-fusion` **0.1.1-rc.2**, npm workspaces), `tsconfig*.json`, `vitest.*.config.ts`, `lefthook.yml`, `pytest.ini` |

Only `git clone` history is missing: **there is no `.git` here** — this is a plain file
copy, so it carries no commits, branches or reflog.

## Status

- **Not a git repo.** `code-fusion/` is the repo; this directory is untracked (`?? cf-old/`).
- **Not built, not maintained, not tested.** Nothing here is wired into the new workspace.
- **Not indexed.** `cf-old/` is excluded in `fusion/.graphifyignore`, so the knowledge
  graph never sees these symbols — indexing it would duplicate every pre-rebrand symbol
  next to its live replacement.
- **Do not import from it.** Cross-tree imports would pull dead modules back into the
  build. Treat it as read-only reference material.

## Why it exists

The rebrand moved the live tree to the new layout (`apps/cli` as the runtime home,
`packages/*` re-partitioned, `examples/`, `skills/`, `vendor/`, `website/`, `native/`,
`python/` folded away). Roughly 6,755 tracked paths were deleted from the repo to do it.
This copy preserves what those paths contained, including the old build artifacts, so a
reviewer can answer "what changed in the restructure?" without digging through git.

## Compare against

| | Old | New |
|---|---|---|
| Location | `code-fusion/cf-old/` | `code-fusion/` |
| Version | `0.1.1-rc.2` | see `code-fusion/package.json` |
| Package manager | npm workspaces (`npm@12.0.2`) | pnpm (`mise.toml` pins the toolchain) |
| Agent runtime | `apps/cli` inside a wider tree | `apps/cli` as the primary entry, `cf` binary |
| Tree size on disk | ~1.45 GB (mostly `node_modules`) | checkout only, dependencies installed separately |

Snapshot of the live repo when this notice was written: `master` @ `0aab37e6`, 6,970
uncommitted paths (this move not yet committed).
