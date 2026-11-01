import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import {
  SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME,
  SOURCE_SERVER_RELEASE_TARGETS,
} from "@origin-ai/cf-shared";

export interface EnsureSshRemoteReleaseAssetsOptions {
  
  releaseDir: string;
  
  prepareReleaseAssets: () => void;
  
  exists?: (path: string) => boolean;
  
  onInfo?: (message: string) => void;
}

function resolveReleaseAssetPaths(releaseDir: string): string[] {
  return [
    join(releaseDir, SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME),
    ...SOURCE_SERVER_RELEASE_TARGETS.map((target) =>
      join(releaseDir, `cf-server-${target}.tar.gz`),
    ),
  ];
}

function listMissingReleaseAssets(releaseDir: string, exists: (path: string) => boolean): string[] {
  return resolveReleaseAssetPaths(releaseDir)
    .filter((assetPath) => !exists(assetPath))
    .map((assetPath) => basename(assetPath));
}

export function ensureSshRemoteReleaseAssets(
  options: EnsureSshRemoteReleaseAssetsOptions,
): boolean {
  const { prepareReleaseAssets, releaseDir } = options;
  const exists = options.exists ?? ((path: string) => existsSync(path));
  const onInfo = options.onInfo ?? ((message: string) => console.log(message));

  const missing = listMissingReleaseAssets(releaseDir, exists);
  if (missing.length === 0) {
    return false;
  }

  onInfo(
    `[e2e] SSH remote assets missing or incomplete: ${releaseDir} ` +
      `(missing: ${missing.join(", ")}); auto-running pnpm prepare:remote-assets`,
  );
  prepareReleaseAssets();

  const stillMissing = listMissingReleaseAssets(releaseDir, exists);
  if (stillMissing.length > 0) {
    throw new Error(
      `[e2e] prepare:remote-assets completed but release still incomplete: ${releaseDir} ` +
        `(missing: ${stillMissing.join(", ")})`,
    );
  }

  return true;
}
