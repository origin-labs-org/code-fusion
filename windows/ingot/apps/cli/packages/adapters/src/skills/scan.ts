// ============================================================
// ============================================================

//
//

import { lstatSync, readdirSync, statSync } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { SKILL_FILE_NAME, shouldWalkSkillDirectoryEntry } from "@origin-ai/cf-shared";

export interface ScanSkillFilesOptions {
  
  followSymbolicLinks?: boolean;
}

export async function scanSkillFilesUnderRoot(
  rootPath: string,
  options: ScanSkillFilesOptions = {},
): Promise<string[]> {
  const followSymlinks = options.followSymbolicLinks ?? true;
  if (!followSymlinks && (await isSymbolicLink(rootPath))) return [];

  const rootInfo = await stat(rootPath).catch((error) => {
    throwIfUnexpectedScanError(error);
    return null;
  });
  if (!rootInfo?.isDirectory()) return [];

  const files: string[] = [];
  const own = join(rootPath, SKILL_FILE_NAME);
  if (await isLoadableSkillFile(own, followSymlinks)) files.push(own);

  const entries = await readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const walkable = entry.isDirectory() || (followSymlinks && entry.isSymbolicLink());
    if (!walkable) continue;
    if (!shouldWalkSkillDirectoryEntry(entry.name)) continue;
    const candidate = join(rootPath, entry.name, SKILL_FILE_NAME);
    if (await isLoadableSkillFile(candidate, followSymlinks)) files.push(candidate);
  }
  return files;
}

export function scanSkillFilesUnderRootSync(
  rootPath: string,
  options: ScanSkillFilesOptions = {},
): string[] {
  const followSymlinks = options.followSymbolicLinks ?? true;
  if (!followSymlinks && isSymbolicLinkSync(rootPath)) return [];

  const rootInfo = statSyncOrNull(rootPath);
  if (!rootInfo?.isDirectory()) return [];

  const files: string[] = [];
  const own = join(rootPath, SKILL_FILE_NAME);
  if (isLoadableSkillFileSync(own, followSymlinks)) files.push(own);

  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const walkable = entry.isDirectory() || (followSymlinks && entry.isSymbolicLink());
    if (!walkable) continue;
    if (!shouldWalkSkillDirectoryEntry(entry.name)) continue;
    const candidate = join(rootPath, entry.name, SKILL_FILE_NAME);
    if (isLoadableSkillFileSync(candidate, followSymlinks)) files.push(candidate);
  }
  return files;
}

async function isLoadableSkillFile(path: string, followSymlinks: boolean): Promise<boolean> {
  if (!followSymlinks && (await isSymbolicLink(path))) return false;
  const info = await stat(path).catch((error) => {
    throwIfUnexpectedScanError(error);
    return null;
  });
  return info?.isFile() ?? false;
}

function isLoadableSkillFileSync(path: string, followSymlinks: boolean): boolean {
  if (!followSymlinks && isSymbolicLinkSync(path)) return false;
  return statSyncOrNull(path)?.isFile() ?? false;
}

async function isSymbolicLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

function isSymbolicLinkSync(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function statSyncOrNull(path: string): { isFile(): boolean; isDirectory(): boolean } | null {
  try {
    return statSync(path);
  } catch (error) {
    throwIfUnexpectedScanError(error);
    return null;
  }
}

function throwIfUnexpectedScanError(error: unknown): void {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  ) {
    return;
  }
  throw error;
}
