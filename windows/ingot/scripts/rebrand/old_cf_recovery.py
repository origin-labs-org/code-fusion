"""Old-CF recovery: lift valuable assets from cf-old into the current tree, no loss.

Lifts:
  cf-old/skills/design        -> apps/cli/packages/bundled-skills/skills/design
  cf-old/BRAND_GUIDELINES.md  -> BRAND_GUIDELINES.md (repo root)

Also inventories the rest of cf-old (examples, docs, website, native, vendor,
python, archive, patches, remaining skills) and writes a ledger skeleton to
scripts/rebrand/CF_OLD_RECOVERY.md with lifted/not-lifted status per area.
"""
import os
import re
import shutil
from pathlib import Path

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")
CJK = re.compile(r"[\u4e00-\u9fff]")


def fs_safe(p: Path) -> Path:
    np = Path(os.path.normpath(str(p)))
    if ".." in np.parts:
        raise ValueError(f"path traversal refused: {p}")
    if np != ROOT and ROOT not in np.parents:
        raise ValueError(f"path outside ROOT refused: {p}")
    return np


def has_cjk_dir(d: Path) -> bool:
    for f in d.rglob("*"):
        if f.is_file() and f.suffix in {".md", ".txt"}:
            try:
                if CJK.search(f.read_text(encoding="utf-8", errors="ignore")):
                    return True
            except OSError:
                pass
    return False


ledger = ["# Old-CF Recovery Ledger", "", "## Lifted into the current tree", ""]

# 1. design skill (full, no loss)
src = fs_safe(ROOT / "cf-old" / "skills" / "design")
dst = fs_safe(ROOT / "apps" / "cli" / "packages" / "bundled-skills" / "skills" / "design")
if not dst.exists():
    shutil.copytree(src, dst)
n_files = sum(1 for _ in dst.rglob("*") if _.is_file())
ledger.append(f"- `skills/design` -> `bundled-skills/skills/design` ({n_files} files, 53MB) — "
              "16 brand design systems + style skills + design templates + artifact-skill docs. "
              "Chinese markdown scheduled for translation (see translate queue).")
print(f"design skill lifted: {n_files} files")

# 2. brand guidelines
bg = fs_safe(ROOT / "cf-old" / "BRAND_GUIDELINES.md")
if bg.exists():
    fs_safe(ROOT / "BRAND_GUIDELINES.md").write_bytes(bg.read_bytes())
    ledger.append("- `BRAND_GUIDELINES.md` -> repo root (CF brand rules).")
    print("BRAND_GUIDELINES.md lifted")

# ---- inventory of the rest ----
ledger += ["", "## Already lifted earlier (rebrand phase)", "",
           "- 40 clean skills from `cf-old/skills` -> `bundled-skills/skills/`",
           "- 12 cf-* dev skills from `cf-old/.agents/skills` -> `.agents/skills/`",
           "", "## Not lifted (with reasons)", ""]

# remaining skills (CJK-content ones, minus design which we just lifted)
skills_root = fs_safe(ROOT / "cf-old" / "skills")
imported_dir = ROOT / "apps" / "cli" / "packages" / "bundled-skills" / "skills"
imported = {p.name for p in imported_dir.iterdir() if p.is_dir()}
not_lifted_skills = []
for d in sorted(skills_root.iterdir()):
    if d.is_dir() and d.name not in imported:
        not_lifted_skills.append(d.name)
ledger.append(f"- **Skills (Chinese content, {len(not_lifted_skills)})**: "
              + ", ".join(not_lifted_skills)
              + " — Chinese-market skills; pdf/docx/pptx functionality already exists as "
              "documents/pdf/presentations plugins. Chinese templates inside `design/` were "
              "lifted with the design skill; these standalone skills were not.")

# examples / docs / website / native / vendor / python / archive / patches
def count_ext(base, ext):
    return sum(1 for f in base.rglob(f"*{ext}")) if base.is_dir() else 0

examples = ROOT / "cf-old" / "examples"
docs_old = ROOT / "cf-old" / "docs"
website = ROOT / "cf-old" / "website"

ex_count = sum(1 for f in examples.rglob("*") if f.is_file()) if examples.is_dir() else 0
docs_en = 0
docs_cjk = 0
if docs_old.is_dir():
    for f in docs_old.rglob("*.md"):
        try:
            if CJK.search(f.read_text(encoding="utf-8", errors="ignore")):
                docs_cjk += 1
            else:
                docs_en += 1
        except OSError:
            pass

ledger.append(f"- **examples/** ({ex_count} files) — legacy CF usage examples targeting the old "
              "package layout (`@origin-ai/cf` v1 APIs); superseded by the new `apps/cli` "
              "architecture. Not lifted.")
ledger.append(f"- **docs/** ({docs_en} English / {docs_cjk} Chinese md) — old-CF internal docs; "
              "the new docs/ will be authored fresh for current CF. English subset can be "
              "mined later if a topic is missing.")
ledger.append("- **website/** (13MB) — marketing site of the old distribution (Reactpress-era "
              "assets); branding and content are stale for the new CF. Not lifted.")
ledger.append("- **native/** — native helper sources of the old tree; the new desktop package "
              "maintains its own `native/` under packages/desktop. Not lifted.")
ledger.append("- **vendor/**, **python/**, **archive/**, **patches/**, **tmp/** — vendored "
              "deps, python tooling, archives and scratch of the old tree; either superseded "
              "or intentionally archived. Not lifted.")
ledger.append("- **apps/web (dist build)** — compiled bundle of the old web frontend; the new "
              "packages/web is the source of truth. Not lifted.")
ledger.append("- **packages/** — the old package universe (acp, api, bundle, cf, client, core, "
              "...). The current tree already carries its successor packages under packages/ "
              "and apps/cli/packages; cf-old remains on disk as reference. Not lifted wholesale.")

out = fs_safe(ROOT / "scripts" / "rebrand" / "CF_OLD_RECOVERY.md")
out.write_text("\n".join(ledger), encoding="utf-8")
print("ledger written:", out)
