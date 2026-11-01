# payloads/skills/

The skills catalog. Each subdirectory is one skill whose `SKILL.md` frontmatter
(`name`, `description`) is what the harness loads — keep that frontmatter intact
when copying skills in; do not rename the frontmatter `name` to "prettify" it.

## Contents

- 49 original bundled skills (`amazon-location-service`, `attorney-assist`,
  `babysit`, `loop`, `shell`, `graphify`, `tabbit`, `workctl`, …) — copied verbatim
  from the installed Qoder 1.18.0 environment; provenance table in
  `windows/ingot/apps/cli/packages/bundled-skills/skills/QODER_SKILLS.md`.
- 29 `ds-*` skills from `github.com/aicodeking/deepseek-stack` — added 2026-11-01.
- `hallmark` from `github.com/Nutlope/hallmark` — added 2026-11-01.
- `ADDED-SKILLS.md` — provenance table (source, files, main file, sha256-16) plus
  the non-official / RE labels for the added sets.
- `.system/` — codex system skills marker + `imagegen` system skill. Not a user
  skill; leave in place.

Adding a skill: see `payloads/README.md`. No skill may claim official vendor
support; RE-derived skills must be labelled.
