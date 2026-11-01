# Base architecture

One launcher, eight parts. No part is named "CodeFusion"; the launcher's window title is
**Launcher**. Parts are addressed by codename, and each codename owns exactly one alias.

```
code-fusion/
├─ launcher/              "Launcher" window — 8 cards, no product logic
│  ├─ index.html          title: Launcher
│  ├─ launch.ps1          .\launch.ps1 [codename|alias]
│  └─ window.json
├─ windows/
│  ├─ ingot/              monorepo tree (apps/, packages/, config/, docs/, node_modules)
│  ├─ onyx/               reverse-engineered Qoder desktop build (CodeFusion.exe + SOURCE/)
│  ├─ chromix/            Zephium browser source
│  ├─ codeix/             OpenAI Codex MSIX (ui-old, ui-new) + toggle
│  ├─ gsx-cli/            opencode workspace (holds MiMoCode source from Xiaomi)
│  ├─ zingma/             empty — seat for Qoder's native Quest/agents window
│  ├─ sonar/              empty — seat for the reverse-engineered DeepSeek Harness (DSH)
│  └─ zenix-cc/           empty — seat for native Claude Desktop
├─ arch/
│  ├─ windows.json        registry: codename, alias, folder, contents, status
│  └─ brand.ts            typed mirror + findPart() / findPartByAlias() / resolvePart()
├─ payloads/               built-in payloads (skills/, extras/, agents/, bundled/, plugins/)
├─ scripts/rebrand/       rename, sync and consistency tooling
└─ BRAND.md               what is decided and what is not
```

| Codename | Alias | Folder | Contents | Status |
| --- | --- | --- | --- | --- |
| **Ingot** | Max | `windows/ingot` | Monorepo tree; 160,239 files (3.9 GB) | present |
| **Onyx** | Studio | `windows/onyx` | RE'd Qoder build — `CodeFusion.exe` + `SOURCE/`; 4,715 files (943 MB) | present |
| **Chromix** | # | `windows/chromix` | Zephium browser source; 3,691 files | present |
| **Codeix** | Pro | `windows/codeix` | OpenAI Codex MSIX (`ui-old`, `ui-new`) + toggle; 2 files | present |
| **GSX-CLI** | # | `windows/gsx-cli` | opencode workspace + MiMoCode (Xiaomi) source; 2,060 files | present |
| **Zingma** | Lite | `windows/zingma` | Qoder's native Quest/agents window (not placed yet) | empty |
| **Sonar** | Plus | `windows/sonar` | reverse-engineered DeepSeek Harness (DSH) (not placed yet) | empty |
| **Zenix CC** | Ultra | `windows/zenix-cc` | native Claude Desktop (not placed yet) | empty |

Ladder: **Lite → Plus → Pro → Studio → Max → Ultra**. `Core` is retired (`#`); Chromix and
GSX-CLI also hold no alias.

## Rules

- **A part is its codename.** Case-insensitive; `resolvePart()` accepts a codename or an alias.
- **One alias per part, five live aliases.** `#` means the alias seat is retired.
- **Roles are not decided.** No part is labelled main/editor/browser; **Ingot is not main**.
- **Provenance is a fact, not a name.** Zephium, opencode, OpenAI Codex, Qoder, DeepSeek and
  Claude describe where a tree came from; they are never the part's name.
- **Launcher owns no logic.** It reads `arch/windows.json`; only **Ingot**
  (`pnpm dev:desktop`) and **Onyx** (`CodeFusion.exe`) have a startable entry, and the script
  says so for the rest.
- **`windows/onyx` is a real folder** — the earlier junction to `windows/obsidian` is gone.

## payloads/

Built-in payloads that ship with the launcher instead of living in a window folder
(counts verified 2026-11-01, after the `inbuilt/bundle` → `payloads` rename and the
29 `ds-*` + `hallmark` skill additions):

| Folder | Files | Size | Contents |
| --- | --- | --- | --- |
| `payloads/skills` | 659 | 3.9 MB | bundled skills (49 original + 29 `ds-*` + `hallmark`) plus `ADDED-SKILLS.md` |
| `payloads/extras` | 4 | 61 MB | source archives (ai-website-cloner-template, anthropic-fonts, deepseek-stack, hallmark) |
| `payloads/agents`, `bundled`, `plugins` | 0 | 0 | empty seats |

Each folder carries a `README.md` (role + how to add) and a `manifest.jsonl` (one
line per file: relative path + full sha256). The empty seats' manifests state
"intentionally empty" so a checkout never looks broken.

## Adding a part

1. Put the build or source in `windows/<codename>/`.
2. Add `{ codename, alias, folder, contents, status }` to `arch/windows.json` and
   `arch/brand.ts`; add the alias to `aliasResolve`.
3. Add a card to `launcher/index.html`.
4. Run `node scripts/rebrand/sync-window-json.mjs` to write every `window.json`.
