"""Lift skills from cf-old into the current tree without duplicates.

- cf-old/skills/<clean>            -> apps/cli/packages/bundled-skills/skills/
  (skip: CJK-containing skills, and names that already exist as a repo
   .agents skill or as a *-plugin package — no duplicates)
- cf-old/.agents/skills/<all-12>   -> .agents/skills/
  (skip any name already present)
Logs every decision to scripts/rebrand/skills_import.log
"""
import os
import re
import shutil
from pathlib import Path

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")
CJK = re.compile(r"[\u4e00-\u9fff]")
LOG = []


def fs_safe(p: Path) -> Path:
    np = Path(os.path.normpath(str(p)))
    if ".." in np.parts:
        raise ValueError(f"path traversal refused: {p}")
    if np != ROOT and ROOT not in np.parents:
        raise ValueError(f"path outside ROOT refused: {p}")
    return np


def dir_has_cjk(d: Path) -> bool:
    for f in d.rglob("*"):
        if f.is_file() and f.suffix in {".md", ".txt", ".py", ".js", ".ts", ".json", ".sh", ".yaml", ".yml"}:
            try:
                if CJK.search(f.read_text(encoding="utf-8", errors="ignore")):
                    return True
            except OSError:
                pass
    return False


# existing-name sets for duplicate avoidance
repo_agents = {p.name for p in (ROOT / ".agents" / "skills").iterdir() if p.is_dir()}
plugin_pkgs = {p.name for p in (ROOT / "apps" / "cli" / "packages").iterdir() if p.is_dir()}
bundled = ROOT / "apps" / "cli" / "packages" / "bundled-skills" / "skills"
bundled_names = {p.name for p in bundled.iterdir() if p.is_dir()} if bundled.is_dir() else set()

imported = skipped_dup = skipped_cjk = 0
for d in sorted((ROOT / "cf-old" / "skills").iterdir()):
    if not d.is_dir():
        continue
    name = d.name
    if name in bundled_names:
        LOG.append(f"skip(dup-bundled): {name}")
        skipped_dup += 1
    elif name in repo_agents:
        LOG.append(f"skip(dup-repo-skill): {name}")
        skipped_dup += 1
    elif f"{name}-plugin" in plugin_pkgs or name.replace("-plugin", "") in {
        p.replace("-plugin", "") for p in plugin_pkgs
    }:
        LOG.append(f"skip(dup-plugin): {name}")
        skipped_dup += 1
    elif dir_has_cjk(d):
        LOG.append(f"skip(cjk-content): {name}")
        skipped_cjk += 1
    else:
        shutil.copytree(fs_safe(d), fs_safe(bundled / name))
        LOG.append(f"imported(bundled): {name}")
        imported += 1

a_imported = a_dup = 0
dest_agents = ROOT / ".agents" / "skills"
for d in sorted((ROOT / "cf-old" / ".agents" / "skills").iterdir()):
    if not d.is_dir():
        continue
    if d.name in repo_agents:
        LOG.append(f"skip(dup-agents): {d.name}")
        a_dup += 1
    else:
        shutil.copytree(fs_safe(d), fs_safe(dest_agents / d.name))
        LOG.append(f"imported(agents): {d.name}")
        a_imported += 1

out = fs_safe(ROOT / "scripts" / "rebrand" / "skills_import.log")
out.write_text("\n".join(LOG), encoding="utf-8")
print(f"bundled: {imported} imported, {skipped_dup} dup-skipped, {skipped_cjk} cjk-skipped")
print(f"agents: {a_imported} imported, {a_dup} dup-skipped")
