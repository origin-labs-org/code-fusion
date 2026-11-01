"""Lift-everything pass: bring ALL remaining skills and HTML/design assets over
from cf-old into the current tree (no-loss directive).

- Remaining cf-old/skills/* (the CJK-content skills) -> bundled-skills/skills/
  (Chinese markdown will be picked up by the md-translation pass.)
  Still skipped, as functional duplicates: agent-browser (exists as a repo
  .agents skill), skill-creator and image-search (exist as CLI plugins).
- Every .html under cf-old/website and cf-old/examples -> legacy-assets/
  preserving subpaths.
- Compiled artifacts (dist/, lib/, apps/web build output) are NOT copied: they
  are build duplicates of lifted sources.
Updates scripts/rebrand/CF_OLD_RECOVERY.md with a completion addendum.
"""
import os
import shutil
from pathlib import Path

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")
BUNDLED = ROOT / "apps" / "cli" / "packages" / "bundled-skills" / "skills"
LEGACY = ROOT / "legacy-assets"
FUNCTIONAL_DUPES = {"agent-browser", "skill-creator", "image-search"}


def fs_safe(p: Path) -> Path:
    np = Path(os.path.normpath(str(p)))
    if ".." in np.parts:
        raise ValueError(f"path traversal refused: {p}")
    if np != ROOT and ROOT not in np.parents:
        raise ValueError(f"path outside ROOT refused: {p}")
    return np


skills_lifted = []
for d in sorted((ROOT / "cf-old" / "skills").iterdir()):
    if not d.is_dir():
        continue
    dest = BUNDLED / d.name
    if dest.exists() or d.name in FUNCTIONAL_DUPES:
        continue
    shutil.copytree(fs_safe(d), fs_safe(dest))
    skills_lifted.append(d.name)
print(f"skills lifted now: {len(skills_lifted)} -> {', '.join(skills_lifted)}")

html_lifted = 0
for area in ("website", "examples"):
    base = ROOT / "cf-old" / area
    if not base.is_dir():
        continue
    for f in base.rglob("*.html"):
        rel = f.relative_to(base)
        dest = fs_safe(LEGACY / area / rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(fs_safe(f), dest)
        html_lifted += 1
print(f"html files lifted: {html_lifted} -> legacy-assets/")

addendum = f"""

## Lift-everything addendum (final pass)

- Remaining {len(skills_lifted)} skills lifted into `bundled-skills/skills/` (Chinese markdown queued for translation).
- {html_lifted} HTML files from `cf-old/website` and `cf-old/examples` lifted into `legacy-assets/`.
- Still intentionally not copied: `agent-browser`, `skill-creator`, `image-search` skills
  (functional duplicates of existing repo skills / CLI plugins), compiled `dist/`+`lib/` build
  outputs (duplicates of lifted sources), and `cf-old/apps/web` build (new packages/web is the source of truth).
"""
ledger = fs_safe(ROOT / "scripts" / "rebrand" / "CF_OLD_RECOVERY.md")
ledger.write_text(ledger.read_text(encoding="utf-8") + addendum, encoding="utf-8")
print("ledger updated")
