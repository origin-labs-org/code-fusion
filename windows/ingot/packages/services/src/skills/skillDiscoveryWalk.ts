import { readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  MAX_SKILL_SCAN_DEPTH,
  SKILL_FILE_NAME,
  shouldWalkSkillDirectoryEntry,
} from "@origin-ai/cf-shared";

export {
  MAX_SKILL_SCAN_DEPTH,
  SKILL_FILE_NAME,
  SKILL_SCAN_EXCLUDED_DIRECTORY_NAMES,
  shouldWalkSkillDirectoryEntry,
} from "@origin-ai/cf-shared";

export interface WalkSkillMarkdownOptions {
  
  onError?: (path: string, error: unknown) => void;
}

export async function* walkSkillMarkdownPaths(
  rootPath: string,
  options: WalkSkillMarkdownOptions = {},
): AsyncGenerator<string> {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: rootPath, depth: 0 }];
  const visitedSymlinkTargets = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const { dir, depth } = current;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      options.onError?.(dir, error);
      continue;
    }

    let hasSkillFile = false;
    const childDirectories: string[] = [];
    const childSymlinks: string[] = [];
    for (const entry of entries) {
      if (entry.name === SKILL_FILE_NAME && !entry.isDirectory()) {
        hasSkillFile = true;
        continue;
      }
      if (!shouldWalkSkillDirectoryEntry(entry.name)) {
        continue;
      }
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        childDirectories.push(entryPath);
      } else if (entry.isSymbolicLink()) {
        childSymlinks.push(entryPath);
      }
    }

    if (hasSkillFile) {
      yield join(dir, SKILL_FILE_NAME);
    }

    if (depth >= MAX_SKILL_SCAN_DEPTH) {
      continue;
    }

    for (const childDirectory of childDirectories) {
      stack.push({ dir: childDirectory, depth: depth + 1 });
    }

    for (const childSymlink of childSymlinks) {
      let targetStat;
      try {
        targetStat = await stat(childSymlink);
      } catch (error) {
        options.onError?.(childSymlink, error);
        continue;
      }
      if (!targetStat.isDirectory()) {
        continue;
      }
      const canonical = await realpath(childSymlink).catch(() => childSymlink);
      if (visitedSymlinkTargets.has(canonical)) {
        continue;
      }
      visitedSymlinkTargets.add(canonical);
      stack.push({ dir: childSymlink, depth: depth + 1 });
    }
  }
}
