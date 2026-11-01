import type { WorkspaceFileEntry } from "@origin-ai/cf-shared";
import {
  getWorkspaceFileAncestorDirectories,
  isWorkspaceFilePathInside,
  type WorkspaceFileTreeRow,
} from "@/workspace-file-tree/model.js";

export function createWorkspaceFileTreeRowsFromSearchEntries(
  entries: WorkspaceFileEntry[],
): WorkspaceFileTreeRow[] {
  return entries.map((entry) => ({
    path: entry.path,
    name: entry.relativePath,
    type: entry.type,
    depth: 0,
    expanded: false,
    loaded: false,
    loading: false,
    error: null,
  }));
}

export function getWorkspaceFileSearchDirectoryRevealPaths({
  workspacePath,
  directoryPath,
}: {
  workspacePath: string;
  directoryPath: string;
}): string[] {
  if (!isWorkspaceFilePathInside(workspacePath, directoryPath)) {
    return [];
  }

  return [...getWorkspaceFileAncestorDirectories(workspacePath, directoryPath), directoryPath];
}
