import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, repositoryRoot), "utf8"));
}

function gitBlobHash(content) {
  return createHash("sha1")
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest("hex");
}

function assertCoherentHunkOffsets(patch) {
  const hunkPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gmu;
  let accumulatedDelta = 0;
  let hunkCount = 0;

  for (const match of patch.matchAll(hunkPattern)) {
    const sourceStart = Number(match[1]);
    const sourceCount = Number(match[2] ?? 1);
    const targetStart = Number(match[3]);
    const targetCount = Number(match[4] ?? 1);
    assert.equal(
      targetStart,
      sourceStart + accumulatedDelta,
      `第 ${hunkCount + 1} 个 hunk Target行Number未Cumulative前序偏移`,
    );
    accumulatedDelta += targetCount - sourceCount;
    hunkCount += 1;
  }

  assert.ok(hunkCount > 1, "ARMS patch 应包含多个连续 hunk");
}

test("ARMS patch 固定 0.0.3 且Target blob 与Install产物One致", async () => {
  const [rootManifest, desktopManifest, npmrc, patch, installedEntry] = await Promise.all([
    readJson("package.json"),
    readJson("packages/desktop/package.json"),
    readFile(new URL(".npmrc", repositoryRoot), "utf8"),
    readFile(new URL("patches/@arms__rum-electron@0.0.3.patch", repositoryRoot), "utf8"),
    readFile(new URL("node_modules/@arms/rum-electron/dist/index.mjs", repositoryRoot)),
  ]);

  assert.match(npmrc, /^node-linker=hoisted$/mu);

  const armsSpecifier = desktopManifest.dependencies?.["@arms/rum-electron"];
  assert.equal(armsSpecifier, "^0.0.3");
  const armsVersion = "0.0.3";
  assert.equal(
    rootManifest.pnpm?.patchedDependencies?.[`@arms/rum-electron@${armsVersion}`],
    `patches/@arms__rum-electron@${armsVersion}.patch`,
  );
  assert.equal(rootManifest.pnpm?.patchedDependencies?.["@arms/rum-electron@0.0.7"], undefined);

  const patchIndex = patch.match(/^index ([0-9a-f]{40})\.\.([0-9a-f]{40}) 100644$/mu);
  assert.ok(patchIndex, "patch 必须RetainComplete的 source/target blob hash");
  assertCoherentHunkOffsets(patch);
  assert.equal(gitBlobHash(installedEntry), patchIndex[2]);
});
