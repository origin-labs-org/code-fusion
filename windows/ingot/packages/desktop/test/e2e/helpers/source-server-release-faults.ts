import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import type { SourceServerReleaseArchive, SourceServerReleaseDescriptor } from "@origin-ai/cf-shared";
import { normalizeRemoteArch, normalizeRemotePlatform } from "@origin-ai/cf-server/remote/detectEnv.js";

export function selectSourceServerReleaseArchive(
  descriptor: SourceServerReleaseDescriptor,
  environment: { platform: string; arch: string },
): SourceServerReleaseArchive {
  const target = `${normalizeRemotePlatform(environment.platform)}-${normalizeRemoteArch(environment.arch)}`;
  const matches = descriptor.archives.filter((archive) => archive.target === target);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Source Server archive for ${target}, received ${matches.length}`,
    );
  }
  return matches[0]!;
}

export async function withSourceServerReleaseFileFault<T>(
  path: string,
  replacement: string | Uint8Array | null,
  run: () => Promise<T>,
): Promise<T> {
  const backup = `${path}.${randomUUID()}.fault-backup`;
  await rename(path, backup);
  try {
    if (replacement !== null) await writeFile(path, replacement);
    return await run();
  } finally {
    await rm(path, { force: true });
    await rename(backup, path);
  }
}
