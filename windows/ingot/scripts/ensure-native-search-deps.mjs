#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveNativeSearchPrebuiltPlan } from "./native-search-tools-config.mjs";
import {
  packageNativeSearchTools,
  resolveNativeSearchPackagedArtifactPath,
} from "./package-native-search-tools.mjs";

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function assertPackagedArchive(filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size === 0) {
    throw new Error(`native search producer did not create archive: ${filePath}`);
  }
}

function assertArchiveSha256(filePath, expectedSha256) {
  const normalizedExpectedSha256 = String(expectedSha256 ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalizedExpectedSha256)) {
    throw new Error(`missing native search archive SHA-256: ${filePath}`);
  }

  const actualSha256 = sha256(filePath);
  if (actualSha256 !== normalizedExpectedSha256) {
    throw new Error(
      `native search archive SHA-256 mismatch: ${filePath}; expected ${normalizedExpectedSha256}, received ${actualSha256}`,
    );
  }
  return actualSha256;
}

function artifactPaths(plan, depsRoot) {
  return plan.artifacts.map((artifact) => ({
    artifact,
    path: resolveNativeSearchPackagedArtifactPath({ artifact, artifactsDir: depsRoot }),
  }));
}

export function canPublishNativeSearchDeps(env = process.env) {
  return (
    env.CI_COMMIT_REF_PROTECTED?.trim().toLowerCase() === "true" ||
    env.CF_NATIVE_SEARCH_ALLOW_PUBLISH?.trim() === "1"
  );
}

export function publishNativeSearchArchive({ sourcePath, destinationPath, expectedSha256 }) {
  assertPackagedArchive(sourcePath);
  const sourceSha256 = assertArchiveSha256(sourcePath, expectedSha256);
  mkdirSync(dirname(destinationPath), { recursive: true });

  if (existsSync(destinationPath)) {
    if (sourceSha256 === sha256(destinationPath)) return false;
    throw new Error(`refusing to overwrite native search archive: ${destinationPath}`);
  }

  const temporaryPath = join(
    dirname(destinationPath),
    `.${basename(destinationPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  copyFileSync(sourcePath, temporaryPath);
  try {
    if (existsSync(destinationPath)) {
      if (sourceSha256 === sha256(destinationPath)) return false;
      throw new Error(`refusing to overwrite native search archive: ${destinationPath}`);
    }
    renameSync(temporaryPath, destinationPath);
    return true;
  } catch (error) {
    if (existsSync(destinationPath) && sourceSha256 === sha256(destinationPath)) return false;
    throw error;
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export async function ensureNativeSearchDeps({
  platform = process.env.CF_TARGET_OS || process.platform,
  arch = process.env.CF_TARGET_ARCH || process.arch,
  depsRoot = process.env.CF_NATIVE_SEARCH_DEPS_ROOT,
  env = process.env,
  allowPublish = canPublishNativeSearchDeps(env),
  tempBaseDir = env.CF_CI_TMPDIR || tmpdir(),
  packageTools = packageNativeSearchTools,
  log = console.log,
  prebuiltPlan,
} = {}) {
  if (!depsRoot?.trim()) {
    throw new Error("CF_NATIVE_SEARCH_DEPS_ROOT is required");
  }

  const resolvedDepsRoot = resolve(depsRoot);
  const plan = prebuiltPlan ?? resolveNativeSearchPrebuiltPlan({ platform, arch });
  const expectedArtifacts = artifactPaths(plan, resolvedDepsRoot);
  const missingOfficial = expectedArtifacts.filter(
    ({ artifact, path }) => artifact.source === "official" && !existsSync(path),
  );

  log("==> Ensure native search deps");
  log(`    target: ${plan.platformKey}`);
  log(`    deps:   ${resolvedDepsRoot}`);

  for (const { artifact, path } of expectedArtifacts) {
    if (existsSync(path)) assertArchiveSha256(path, artifact.archiveSha256);
  }

  if (missingOfficial.length > 0) {
    throw new Error(
      `Microsoft native search archives are missing and cannot be produced: ${missingOfficial
        .map(({ path }) => path)
        .join(", ")}`,
    );
  }

  const missingProducer = expectedArtifacts.filter(
    ({ artifact, path }) => artifact.source === "producer" && !existsSync(path),
  );
  if (missingProducer.length === 0) {
    log(`    [skip] producer archives already exist for ${plan.platformKey}`);
    return { plan, published: [] };
  }

  if (!allowPublish) {
    throw new Error(
      `native search producer archives are missing for ${plan.platformKey}: ${missingProducer
        .map(({ artifact }) => artifact.releaseFileName)
        .join(
          ", ",
        )}. Run a protected pipeline or set CF_NATIVE_SEARCH_ALLOW_PUBLISH=1 in a trusted pipeline`,
    );
  }

  mkdirSync(resolve(tempBaseDir), { recursive: true });
  const workDir = mkdtempSync(
    join(resolve(tempBaseDir), `cf-native-search-deps-${plan.platformKey}-`),
  );
  const stagingDepsRoot = join(workDir, "deps");
  const buildOutputDir = join(workDir, "binaries");
  const published = [];

  try {
    log(
      `    [build] ${missingProducer.map(({ artifact }) => artifact.toolId).join(", ")} (${plan.platformKey})`,
    );
    const packagedPlan = await packageTools({
      platform: plan.platform,
      arch: plan.arch,
      artifactsDir: stagingDepsRoot,
      buildOutputDir,
    });

    for (const { artifact, path: destinationPath } of missingProducer) {
      const packagedArtifact = packagedPlan.artifacts.find(
        (candidate) =>
          candidate.toolId === artifact.toolId &&
          candidate.releaseFileName === artifact.releaseFileName,
      );
      if (!packagedArtifact || packagedArtifact.source !== "producer") {
        throw new Error(`producer plan did not include ${artifact.releaseFileName}`);
      }

      const sourcePath = resolveNativeSearchPackagedArtifactPath({
        artifact: packagedArtifact,
        artifactsDir: stagingDepsRoot,
      });
      const didPublish = publishNativeSearchArchive({
        sourcePath,
        destinationPath,
        expectedSha256: artifact.archiveSha256,
      });
      if (didPublish) published.push(destinationPath);
      log(
        `    [${didPublish ? "publish" : "race-skip"}] ${artifact.releaseFileName} sha256=${sha256(destinationPath)}`,
      );
    }
  } finally {
    rmSync(workDir, { force: true, recursive: true });
  }

  for (const { artifact, path } of expectedArtifacts) {
    if (!existsSync(path)) throw new Error(`native search archive is still missing: ${path}`);
    assertArchiveSha256(path, artifact.archiveSha256);
  }
  log(`==> Done! native search deps (${plan.platformKey})`);
  return { plan, published };
}

function readOption(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  await ensureNativeSearchDeps({
    platform: readOption("platform") ?? process.env.CF_TARGET_OS ?? process.platform,
    arch: readOption("arch") ?? process.env.CF_TARGET_ARCH ?? process.arch,
    depsRoot: readOption("deps-root") ?? process.env.CF_NATIVE_SEARCH_DEPS_ROOT,
  });
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}
