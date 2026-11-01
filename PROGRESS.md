# PROGRESS.md — code-fusion payloads work (session: Code Swing)

## Goal
Integrate 29 deepseek-stack skills + hallmark into the skills catalog (TASK 1), then
professionally rename/rearrange `inbuilt/bundle/` (TASK 2). Keep
`node scripts/rebrand/check-consistency.mjs` at 8/8. Solo work, no subagents. Task 3
(templates repo) stays PENDING until Prime Orchestrator says go — user echoed this
("@Prime-Orchestrator se baat karo").

## Done (with evidence)

### TASK 1 — 29 ds-skills + hallmark integrated
- Baseline gate: `node scripts/rebrand/check-consistency.mjs` → `8/8 checks passed` EXIT=0.
- Copy 29 `ds-*` skill dirs from `.extract-tmp/ds1/deepseek-stack-main/skills/` (conflict
  check `NONE`). Verified `ds-watch-pr` brought `scripts/watch_pr.py` with SKILL.md.
- Copy `hallmark` from `.extract-tmp/hm1/hallmark-main/skills/hallmark/` — 183 files
  (SKILL.md + 50 themes + refs + scripts). Conflict `NONE`.
- Post-copy totals: **79 skill dirs, 89 SKILL.md, 659 files** (was 49 dirs / 59 / 446).
- Provenance: `ADDED-SKILLS.md` (QODER_SKILLS.md table format, full sha256-16, non-official
  / RE labels). Naming decision: keep `ds-*` prefix, intact frontmatter (rationale in §Naming
  decision there).

### TASK 2 — `inbuilt/bundle/` → `payloads/` (user picked "payloads/ (dono rename)")
- Verified blast radius first: `check-consistency.mjs:12-14,48-49` reads only `arch/windows.json`,
  `launcher/index.html`, `launcher/window.json` — it never touches `inbuilt/`. Grep for
  `inbuilt` across `scripts/`, `launcher/`, `arch/`, `windows/` found only a historical
  comment in `scripts/rebrand/migrate-arch.mjs:2`.
- Rename executed: `inbuilt\bundle\*` → new top-level `payloads\`, `inbuilt\` removed.
  Verified: 660 skills files preserved, 89 SKILL.md, 4 extras zips, 5 subfolders.
- READMEs added: `payloads/README.md` (layout + how-to-add) and one per subfolder
  (`skills`, `extras`, `agents`, `bundled`, `plugins`). Empty seats say "intentionally empty".
- Manifests: per-file JSONL in every subfolder — `{"path","size","sha256"}` (full sha256).
  skills=659 lines, extras=4, agents/bundled/plugins=1 "intentionally empty" line each.
- `arch/README.md` updated: tree diagram + `## payloads/` table now show the real counts
  (659 files skills / 4 extras / 3 empty seats).
- `ADDED-SKILLS.md` path references re-pointed `inbuilt/bundle/skills` → `payloads/skills`.
- Gate after every edit: **8/8 checks passed, EXIT=0** (run 3×: baseline, post-copy,
  post-rename — all green).

## Next
1. Report to Prime Orchestrator (TASK 1+2 done, TASK 3 awaiting their go).
2. Nothing else started — Task 3 (`.extract-tmp/cct` → 5696 skills + agents/commands/hooks/
   mcps/mods/settings) is NOT started by design.

## Open questions
1. `windows/ingot/skills-lock.json` + `bundled-skills` are Ingot's (peer: read-only). The
   Ingot CLI's own skill bundle (122 skills, `QODER_SKILLS.md`) is separate from
   `payloads/skills` — confirm the two are meant to stay separate and `payloads/` is the
   launcher-level catalog, not a mirror of Ingot's.
2. `.agents/skills` (23 dirs, untracked) — runtime install location, intentionally outside
   `payloads/`; left untouched, documented here so it isn't mistaken for drift.

## Key facts (verified)
- Gate: 8/8; reads `arch/windows.json`, `launcher/index.html`, `launcher/window.json` only.
- Original catalog: 49 skill dirs + `.system/`; 59 SKILL.md; 446 files.
- extras zips: ai-website-cloner-template-master.zip 943096 (af5a3cfdc92a5451);
  anthropic-fonts-main.zip 1780621 (995ae44ebffa3230);
  deepseek-stack-main.zip 49499 (94b3f5f483b93d96);
  hallmark-main.zip 61375608 (7257adce3c3f828f).
- `bundled/`'s four dotdirs (`.claude`, `.codex`, `.qoder`, `.zcode`) are all empty.
- `inbuilt/` top level contained ONLY `bundle/` before the rename.
- transformers-fusion is OUT of scope (Fusion Smash domain) per peer; the SPEC-INFERNO plan
  lives at `~/.claude/plans/transformers-fusion-spec-inferno-md-pla-pure-parrot.md` for the
  user's original request.
