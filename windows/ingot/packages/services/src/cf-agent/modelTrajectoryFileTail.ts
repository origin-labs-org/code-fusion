import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDataBaseDir } from "#src/paths.js";

const MAX_TRAJECTORY_READ_BYTES = 32 * 1024 * 1024;

export interface TrajectoryFileTail {
  text: string;
  bytesRead: number;
  truncated: boolean;
}

export function resolveModelIODirs(): string[] {
  const roots = new Set<string>([
    join(homedir(), ".cf", "cli"),
    join(getDataBaseDir(), ".cf", "cli"),
  ]);
  return [...roots].flatMap((root) => [join(root, "debug"), join(root, "rollout")]);
}

export function sanitizeSessionSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function readTrajectoryFileTail(filePath: string): Promise<TrajectoryFileTail> {
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - MAX_TRAJECTORY_READ_BYTES);
    const length = size - start;
    const buffer = Buffer.allocUnsafe(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const result = await handle.read(buffer, bytesRead, length - bytesRead, start + bytesRead);
      if (result.bytesRead === 0) {
        break;
      }
      bytesRead += result.bytesRead;
    }

    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline === -1 ? "" : text.slice(firstNewline + 1);
    }
    return { text, bytesRead, truncated: start > 0 };
  } finally {
    await handle.close();
  }
}
