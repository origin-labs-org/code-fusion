import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { stageE2EAppOutput } from "./e2e/helpers/e2e-app-output-stage.js";

const testDirs: string[] = [];

afterEach(async () => {
  await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function createTestDirs() {
  const root = await mkdtemp(resolve("packages/desktop", ".e2e-stage-test-"));
  testDirs.push(root);
  return {
    destination: resolve(root, "destination"),
    root,
    source: resolve(root, "source"),
  };
}

describe("desktop E2E app output staging", () => {
  it("Recursive snapshots preserve original artifacts after shared builds are overwritten in-place by type checking", async () => {
    const { destination, source } = await createTestDirs();
    await mkdir(resolve(source, "host"), { recursive: true });
    const sourceEntry = resolve(source, "host", "index.js");
    await writeFile(sourceEntry, "bundled-host");
    await stageE2EAppOutput(source, destination);
    await writeFile(sourceEntry, "unbundled-tsc-output");
    expect(await readFile(resolve(destination, "host", "index.js"), "utf8")).toBe("bundled-host");
  });

  it("Do not pollute shared builds or other shards when modifying isolated copies in test cases", async () => {
    const { destination, root, source } = await createTestDirs();
    await mkdir(source, { recursive: true });
    await writeFile(resolve(source, "main.js"), "original");
    const another = resolve(root, "another-shard");
    await stageE2EAppOutput(source, destination);
    await stageE2EAppOutput(source, another);
    await writeFile(resolve(destination, "main.js"), "case-specific");
    expect(await readFile(resolve(source, "main.js"), "utf8")).toBe("original");
    expect(await readFile(resolve(another, "main.js"), "utf8")).toBe("original");
  });
});
