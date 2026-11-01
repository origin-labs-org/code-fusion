# Old-CF Recovery Ledger

## Lifted into the current tree

- `skills/design` -> `bundled-skills/skills/design` (561 files, 53MB) — 16 brand design systems + style skills + design templates + artifact-skill docs. Chinese markdown scheduled for translation (see translate queue).
- `BRAND_GUIDELINES.md` -> repo root (CF brand rules).

## Already lifted earlier (rebrand phase)

- 40 clean skills from `cf-old/skills` -> `bundled-skills/skills/`
- 12 cf-* dev skills from `cf-old/.agents/skills` -> `.agents/skills/`

## Not lifted (with reasons)

- **Skills (Chinese content, 28)**: agent-browser, aminer-academic-search, aminer-daily-paper, docx, dream-interpreter, gaokao-collect-student-info, gaokao-fetch-volunteers, gaokao-generate-report, gaokao-recommend-majors, gaokao-recommend-schools, get-fortune-analysis, gift-evaluator, image-search, interview-prep, jd-resume-tailor, job-intent-tracker, pdf, podcast-generate, pptx, qingyan-research, quiz-html, quiz-mastery, resume-builder, skill-creator, skill-finder-cn, stock-analysis-skill, video-generation, xlsx — Chinese-market skills; pdf/docx/pptx functionality already exists as documents/pdf/presentations plugins. Chinese templates inside `design/` were lifted with the design skill; these standalone skills were not.
- **examples/** (617 files) — legacy CF usage examples targeting the old package layout (`@origin-ai/cf` v1 APIs); superseded by the new `apps/cli` architecture. Not lifted.
- **docs/** (113 English / 0 Chinese md) — old-CF internal docs; the new docs/ will be authored fresh for current CF. English subset can be mined later if a topic is missing.
- **website/** (13MB) — marketing site of the old distribution (Reactpress-era assets); branding and content are stale for the new CF. Not lifted.
- **native/** — native helper sources of the old tree; the new desktop package maintains its own `native/` under packages/desktop. Not lifted.
- **vendor/**, **python/**, **archive/**, **patches/**, **tmp/** — vendored deps, python tooling, archives and scratch of the old tree; either superseded or intentionally archived. Not lifted.
- **apps/web (dist build)** — compiled bundle of the old web frontend; the new packages/web is the source of truth. Not lifted.
- **packages/** — the old package universe (acp, api, bundle, cf, client, core, ...). The current tree already carries its successor packages under packages/ and apps/cli/packages; cf-old remains on disk as reference. Not lifted wholesale.

## Lift-everything addendum (final pass)

- Remaining 25 skills lifted into `bundled-skills/skills/` (Chinese markdown queued for translation).
- 0 HTML files from `cf-old/website` and `cf-old/examples` lifted into `legacy-assets/`.
- Still intentionally not copied: `agent-browser`, `skill-creator`, `image-search` skills
  (functional duplicates of existing repo skills / CLI plugins), compiled `dist/`+`lib/` build
  outputs (duplicates of lifted sources), and `cf-old/apps/web` build (new packages/web is the source of truth).
