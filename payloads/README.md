# payloads/

Built-in payloads that ship with the launcher instead of living in a window folder.
Renamed from `inbuilt/bundle/` on 2026-11-01 (the old path is gone; the consistency
gate does not read this tree, verified against `scripts/rebrand/check-consistency.mjs`).

## Layout

| Folder | Role | Status |
| --- | --- | --- |
| `skills/` | The skills catalog — skill dirs each with a `SKILL.md` whose frontmatter (`name`, `description`) is what the harness loads. | 79 dirs (49 original, 29 `ds-*`, 1 `hallmark`) |
| `extras/` | Source archives (zips) that payloads were extracted from. Never deleted; inventoried in `extras/README.md` and `extras/manifest.jsonl`. | 4 zips |
| `agents/` | Seat for agent definitions. | intentionally empty |
| `bundled/` | Seat per-tool dotdirs (`.claude`, `.codex`, `.qoder`, `.zcode`). | intentionally empty |
| `plugins/` | Seat for plugins. | intentionally empty |

Every folder has a `README.md` (role + how to add) and a `manifest.jsonl` — one line
per file: `{"path": "<relative>", "size": <bytes>, "sha256": "<full>"}`. Empty seats'
manifests carry a single `{"note":"intentionally empty","files":0}` line so a checkout
never looks like a missing-files bug.

## Adding a skill

1. Copy the skill dir into `skills/`; keep `SKILL.md` frontmatter (`name`,
   `description`) intact — the harness loads from that frontmatter, so the dir name
   should match `name`.
2. Do not overwrite an existing dir; check for name collisions first.
3. Append a row to `skills/ADDED-SKILLS.md` (source, files, main file, sha256-16)
   and re-run the manifest generator (see `scripts/` or regenerate per folder).
4. No skill may claim official vendor support; RE-derived skills must say so
   (`ADDED-SKILLS.md` carries those labels for the `ds-*` and `hallmark` sets).
