import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME,
  SOURCE_SERVER_RELEASE_TARGETS,
  sourceServerReleaseDescriptorSchema,
  type SourceServerReleaseTarget,
} from "@origin-ai/cf-shared";

export { SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME };
export const SOURCE_SERVER_REMOTE_RELEASE_TARGETS = SOURCE_SERVER_RELEASE_TARGETS;

export async function beginSourceServerRemoteReleaseGeneration(options: {
  versionReleaseDir: string;
}): Promise<void> {
  await mkdir(options.versionReleaseDir, { recursive: true });
  await rm(join(options.versionReleaseDir, SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME), {
    force: true,
  });
}

async function copyFileAtomic(source: string, destination: string): Promise<void> {
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary);
    await rm(destination, { force: true });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function collectSourceServerRemoteReleaseArchives(options: {
  distReleaseDir: string;
  versionReleaseDir: string;
  version: string;
  targets?: readonly SourceServerReleaseTarget[];
}): Promise<string[]> {
  await beginSourceServerRemoteReleaseGeneration({
    versionReleaseDir: options.versionReleaseDir,
  });
  const sources = (options.targets ?? SOURCE_SERVER_REMOTE_RELEASE_TARGETS).map((target) => ({
    target,
    fileName: `cf-server-${target}.tar.gz`,
    path: join(options.distReleaseDir, `cf-server-${target}.tar.gz`),
  }));
  for (const source of sources) {
    try {
      await access(source.path);
    } catch {
      throw new Error(
        `Missing Source Server remote release archive for ${source.target}: ${source.path}`,
      );
    }
  }
  const collected: string[] = [];
  const archives = [];
  for (const source of sources) {
    const destination = join(options.versionReleaseDir, source.fileName);
    await copyFileAtomic(source.path, destination);
    collected.push(destination);
    const [sha256, fileStat] = await Promise.all([sha256File(destination), stat(destination)]);
    archives.push({
      target: source.target,
      version: options.version,
      fileName: source.fileName,
      sha256,
      sizeBytes: fileStat.size,
      urls: [source.fileName],
    });
  }
  const descriptor = sourceServerReleaseDescriptorSchema.parse({
    schemaVersion: 1,
    version: options.version,
    archives,
  });
  const descriptorPath = join(
    options.versionReleaseDir,
    SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME,
  );
  const temporaryDescriptorPath = `${descriptorPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryDescriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
    await rename(temporaryDescriptorPath, descriptorPath);
  } finally {
    await rm(temporaryDescriptorPath, { force: true }).catch(() => undefined);
  }
  return collected;
}
