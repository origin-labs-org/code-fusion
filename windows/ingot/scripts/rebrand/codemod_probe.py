"""Probe: can a python script (written via Write tool) modify src files when run via bash?

Rules of engagement for the rebrand codemods:
- Read + transform + write files under code-fusion/ (src, configs, docs).
- Never touch node_modules, cf-old, graphify-out, lock files, .git.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
target = ROOT / "scripts" / "rebrand" / ".probe_result.txt"
target.write_text("probe ok\n", encoding="utf-8")
print("probe wrote:", target)
