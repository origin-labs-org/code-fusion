import type { WorkspaceFileEntry } from "@origin-ai/cf-shared";

const FIELD_SEPARATOR = "\t";
const LINE_SEPARATOR = "\n";

export const WORKSPACE_FILE_ENTRIES_CHUNK_SIZE = 4_000_000;

function escapeField(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n");
}

const UNESCAPE_PATTERN = /\\(.)/g;

function unescapeField(value: string): string {
  return value.replace(UNESCAPE_PATTERN, (match, char: string) => {
    if (char === "t") {
      return "\t";
    }
    if (char === "n") {
      return "\n";
    }
    return char;
  });
}

export function packWorkspaceFileEntries(entries: WorkspaceFileEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    lines.push(`${entry.type}${FIELD_SEPARATOR}${escapeField(entry.relativePath)}`);
  }
  return lines.join(LINE_SEPARATOR);
}

export function unpackWorkspaceFileEntries(packed: string, rootPath: string): WorkspaceFileEntry[] {
  if (packed.length === 0) {
    return [];
  }
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const prefix =
    rootPath.endsWith("/") || rootPath.endsWith("\\") ? rootPath : `${rootPath}${separator}`;
  const lines = packed.split(LINE_SEPARATOR);
  const entries: WorkspaceFileEntry[] = [];
  for (const line of lines) {
    if (!line) {
      continue;
    }
    const tabAt = line.indexOf(FIELD_SEPARATOR);
    if (tabAt === -1) {
      continue;
    }
    const relativePath = unescapeField(line.slice(tabAt + 1));
    const lastSlash = relativePath.lastIndexOf("/");
    const pathPart = separator === "/" ? relativePath : relativePath.split("/").join("\\");
    entries.push({
      name: lastSlash === -1 ? relativePath : relativePath.slice(lastSlash + 1),
      path: `${prefix}${pathPart}`,
      relativePath,
      type: line.slice(0, tabAt) === "directory" ? "directory" : "file",
    });
  }
  return entries;
}
