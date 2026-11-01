import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

export function resolvePatchedDependencyPackageName(key) {
  const value = key.trim();
  const match = value.startsWith("@")
    ? value.match(/^(@[^/]+\/[^@]+)@/u)
    : value.match(/^([^@]+)@/u);
  if (!match?.[1]) {
    throw new Error(`Invalid patched dependency key: ${key}`);
  }
  return match[1];
}

async function pathExists(path) {
  return await access(path).then(
    () => true,
    () => false,
  );
}

export async function clearHoistedPatchedDependencyTargets({ rootDir, packageJsonPath }) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const patchedDependencies = packageJson.pnpm?.patchedDependencies ?? {};
  const packageNames = Object.keys(patchedDependencies).map(resolvePatchedDependencyPackageName);
  const removed = [];
  for (const packageName of packageNames) {
    const target = join(rootDir, "node_modules", ...packageName.split("/"));
    if (!(await pathExists(target))) continue;
    await rm(target, { recursive: true, force: true });
    removed.push(packageName);
  }
  return removed;
}
