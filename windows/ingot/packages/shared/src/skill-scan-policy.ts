// ============================================================
// Skill scan policy (pure, no I/O)
// ============================================================
//
//

export const SKILL_FILE_NAME = "SKILL.md";

export const SKILL_SCAN_EXCLUDED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  ".cache",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
]);

export const MAX_SKILL_SCAN_DEPTH = 8;

const SKILL_DISCOVERY_DOT_DIR_ALLOWLIST = new Set([".system"]);

export function shouldWalkSkillDirectoryEntry(entryName: string): boolean {
  if (SKILL_SCAN_EXCLUDED_DIRECTORY_NAMES.has(entryName)) {
    return false;
  }
  if (!entryName.startsWith(".")) {
    return true;
  }
  return SKILL_DISCOVERY_DOT_DIR_ALLOWLIST.has(entryName);
}
