# Naming — current state

Updated 2026-10-31. Facts only. Several things are **not decided**, and this file says so
instead of inventing them.

## What is decided

- The launcher's name is **Launcher Desktop**; its window title is **Launcher**.
- Parts are addressed by their **folder codename**; aliases resolve to one part each.
- **Aliases are decided** — the edition ladder is Lite → Plus → Pro → Studio → Max → Ultra.

## What is NOT decided

- **Roles.** No part has an assigned role. **Ingot is not the main part.**
- The old names are **not** part names. `Max` is the alias of **Ingot**. `Magnus`, `Prism`,
  `Titanium`, `Maxxi`, `Aether` and `CodeFusion Max` were dropped and are not coming back.

## Parts on disk

| Codename | Folder | Status | Contents (verified) |
| --- | --- | --- | --- |
| **Ingot** | `windows/ingot` | present | Monorepo tree — `apps/`, `packages/`, `config/`, `docs/`, `node_modules`; 160,239 files (3.9 GB) |
| **Onyx** | `windows/onyx` | present | Reverse-engineered Qoder desktop build — `CodeFusion.exe` plus `SOURCE/`; 4,715 files (943 MB) |
| **Chromix** | `windows/chromix` | present | Zephium browser source — package name `zephium`, `crates/`, `desktop/`, `eval/`; 3,691 files |
| **Codeix** | `windows/codeix` | present | Two OpenAI Codex MSIX packages (`ui-old` 26.707.3748.0, `ui-new` 26.1021.3705.0); installers stay local (1.59 GB, git-ignored) |
| **GSX-CLI** | `windows/gsx-cli` | present | opencode workspace — package name `opencode`, `packages/`, `bun.lock`; 2,060 files (MiMoCode's source-code by Xiomi) |
| **Zingma** | `windows/zingma` | empty | only `window.json` — seat for Qoder's native Quest/agents window |
| **Sonar** | `windows/sonar` | empty | only `window.json` — seat for the reverse-engineered DeepSeek Harness (DSH) |
| **Zenix CC** | `windows/zenix-cc` | empty | only `window.json` — seat for native Claude Desktop |

## Aliases (decided)

| Alias | Part | Why this alias |
| --- | --- | --- |
| **#** | **GSX-CLI** | terminal layer — the smallest surface |
| **#** | **Chromix** | single-purpose browser |
| **Lite** | Zingma | seat reserved below all which will get replaced with Qoder's native & built-in Quest window |
| **Plus** | Sonar | reverse-engineered DeepSeek Harness (DSH) seat |
| **Pro** | Codeix | Codex coding surface |
| **Studio** | Aster | deep editor workspace |
| **Max** | Ingot | largest tree on disk (3.9 GB) — says size, **not** "main" |
| **Ultra** | Zenix CC | native Claude Desktop seat, outside the ladder |

Ladder order: **Lite → Plus → Pro → Studio → Max → Ultra** (lightest to heaviest). `Core` is
retired (`#`) and maps to no part; Chromix and GSX-CLI also hold no alias.
Sending an alias to the launcher resolves it: `.\launch.ps1 studio` → Onyx.

## Launcher Desktop

| Name (exact) | Folder | Window title | Job |
| --- | --- | --- | --- |
| **Launcher Desktop** | `launcher/` | `Launcher` | Lists parts and starts the two that have an entry point. No product logic. |

## Rules

- Do not invent a role or an alias. Only the registry assigns them; a new part starts with
  `alias: null` until one is decided.
- The fork of a part may be stated as a fact (Zephium, opencode, OpenAI Codex, Qoder,
  DeepSeek, Claude) — that is provenance, not naming.
- The only `CodeFusion` string left in the tree is the executable name of Onyx
  (`CodeFusion.exe`); renaming it is a separate mechanical step.

## Where this lives

- `arch/windows.json` — registry: codename, alias, folder, contents, status.
- `arch/brand.ts` — typed mirror + `findPart()`; `ALIASES` maps the five live aliases.
- `arch/README.md` — tree and rules.
- `launcher/` — `index.html`, `launch.ps1`, `window.json`.
