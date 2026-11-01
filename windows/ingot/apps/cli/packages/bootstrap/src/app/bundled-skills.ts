import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Logger, SkillRoot } from "@origin-ai/cf-contracts";
import { DYNAMIC_WORKFLOW_SKILL_NAME } from "@origin-ai/cf-contracts";
import { candidateBaseDirs } from "./bundled-plugins.js";

export const BUNDLED_SKILL_PACK_DIRECTORY_NAME = "bundled-skills";
export const BUNDLED_SKILL_PACK_SKILLS_DIRECTORY = "skills";

export { DYNAMIC_WORKFLOW_SKILL_NAME };

export const BUNDLED_SKILL_PACK_REQUIRED_PATHS = [
  `skills/${DYNAMIC_WORKFLOW_SKILL_NAME}/SKILL.md`,
  `skills/${DYNAMIC_WORKFLOW_SKILL_NAME}/patterns.md`,
  `skills/${DYNAMIC_WORKFLOW_SKILL_NAME}/examples.md`,
] as const;

const BUNDLED_SKILL_PACK_ROOT_CANDIDATES = [
  `packages/${BUNDLED_SKILL_PACK_DIRECTORY_NAME}`,
  `../${BUNDLED_SKILL_PACK_DIRECTORY_NAME}`,
  `../../${BUNDLED_SKILL_PACK_DIRECTORY_NAME}`,
  `../../../${BUNDLED_SKILL_PACK_DIRECTORY_NAME}`,
] as const;

export const SEA_BUNDLED_SKILL_ASSET_PREFIX = "cf-bundled-skills/";
const SEA_BUNDLED_SKILL_MANIFEST_ASSET_KEY = `${SEA_BUNDLED_SKILL_ASSET_PREFIX}manifest.json`;
const SEED_MARKER_FILE = ".cf-bundled-skills-seed.json";

const BUNDLED_SKILL_ROOT_PRIORITY = 1_000_000;

interface SeaBundledSkillManifest {
  files: Array<{ mode?: number; path: string; sha256: string }>;
  hash: string;
  version: 1;
}

type SeaModule = typeof import("node:sea");

export interface ResolveBundledSkillRootsOptions {
  
  cliStorageRoot: string;
  logger?: Logger;
}

export function resolveBundledSkillRoots(options: ResolveBundledSkillRootsOptions): SkillRoot[] {
  const packRoot =
    materializeSeaBundledSkillPack(options) ?? resolveFilesystemBundledSkillPackRoot();
  if (!packRoot) {
    options.logger?.warn("Bundled skill pack unavailable", {
      module: "bootstrap.bundled_skills",
      requiredPaths: [...BUNDLED_SKILL_PACK_REQUIRED_PATHS],
    });
    return [];
  }
  return [
    {
      path: join(packRoot, BUNDLED_SKILL_PACK_SKILLS_DIRECTORY),
      priority: BUNDLED_SKILL_ROOT_PRIORITY,
      scope: "system",
      source: "bundled",
    },
  ];
}

export function findMissingBundledSkillPackPaths(packRoot: string): string[] {
  return BUNDLED_SKILL_PACK_REQUIRED_PATHS.filter(
    (requiredPath) => !existsSync(join(packRoot, ...requiredPath.split("/"))),
  );
}

function resolveFilesystemBundledSkillPackRoot(): string | undefined {
  for (const baseDir of candidateBaseDirs()) {
    for (const relativePath of BUNDLED_SKILL_PACK_ROOT_CANDIDATES) {
      const packRoot = resolve(baseDir, relativePath);
      if (
        existsSync(join(packRoot, BUNDLED_SKILL_PACK_SKILLS_DIRECTORY)) &&
        findMissingBundledSkillPackPaths(packRoot).length === 0
      ) {
        return packRoot;
      }
    }
  }
  return undefined;
}

function materializeSeaBundledSkillPack(
  options: ResolveBundledSkillRootsOptions,
): string | undefined {
  const sea = getSeaModule();
  if (!sea?.isSea()) return undefined;
  const manifest = readSeaManifest(sea);
  if (!manifest) return undefined;

  const packsRoot = join(options.cliStorageRoot, BUNDLED_SKILL_PACK_DIRECTORY_NAME);
  const targetRoot = join(packsRoot, manifest.hash);
  if (isSeedComplete(targetRoot, manifest.hash)) return targetRoot;

  const temporaryRoot = `${targetRoot}.tmp-${process.pid}-${Date.now()}`;
  try {
    mkdirSync(temporaryRoot, { recursive: true });
    for (const file of manifest.files) {
      const bytes = Buffer.from(sea.getRawAsset(`${SEA_BUNDLED_SKILL_ASSET_PREFIX}${file.path}`));
      if (hashBytes(bytes) !== file.sha256) {
        throw new Error(`Bundled skill asset hash mismatch: ${file.path}`);
      }
      const outputPath = join(temporaryRoot, ...file.path.split("/"));
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, bytes, { mode: file.mode ?? 0o644 });
    }
    writeFileSync(
      join(temporaryRoot, SEED_MARKER_FILE),
      JSON.stringify({ hash: manifest.hash, version: 1 }, null, 2),
    );
    mkdirSync(packsRoot, { recursive: true });
    renameSync(temporaryRoot, targetRoot);
    return targetRoot;
  } catch (error) {
    rmSync(temporaryRoot, { force: true, recursive: true });
    if (isSeedComplete(targetRoot, manifest.hash)) return targetRoot;
    const fallbackRoot = findUsableSeededPack(packsRoot);
    options.logger?.warn("Bundled skill pack seed degraded", {
      error: error instanceof Error ? error.message : String(error),
      fallbackRoot,
      module: "bootstrap.bundled_skills",
      targetRoot,
    });
    return fallbackRoot;
  }
}

function isSeedComplete(targetRoot: string, expectedHash: string): boolean {
  try {
    const marker = JSON.parse(readFileSync(join(targetRoot, SEED_MARKER_FILE), "utf8")) as {
      hash?: unknown;
    };
    if (marker.hash !== expectedHash) return false;
  } catch {
    return false;
  }
  return findMissingBundledSkillPackPaths(targetRoot).length === 0;
}

function findUsableSeededPack(packsRoot: string): string | undefined {
  let entries;
  try {
    entries = readdirSync(packsRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.includes(".tmp-"))
    .map((entry) => join(packsRoot, entry.name))
    .find((packRoot) => {
      try {
        const marker = JSON.parse(readFileSync(join(packRoot, SEED_MARKER_FILE), "utf8")) as {
          hash?: unknown;
        };
        return typeof marker.hash === "string" && isSeedComplete(packRoot, marker.hash);
      } catch {
        return false;
      }
    });
}

function readSeaManifest(sea: SeaModule): SeaBundledSkillManifest | undefined {
  try {
    const manifest = JSON.parse(
      sea.getAsset(SEA_BUNDLED_SKILL_MANIFEST_ASSET_KEY, "utf8"),
    ) as SeaBundledSkillManifest;
    return manifest.version === 1 &&
      typeof manifest.hash === "string" &&
      Array.isArray(manifest.files)
      ? manifest
      : undefined;
  } catch {
    return undefined;
  }
}

function getSeaModule(): SeaModule | undefined {
  const getBuiltinModule = process.getBuiltinModule as ((id: "node:sea") => SeaModule) | undefined;
  try {
    return getBuiltinModule?.("node:sea");
  } catch {
    return undefined;
  }
}

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
