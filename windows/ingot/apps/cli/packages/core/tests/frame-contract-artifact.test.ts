import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// The subpath export is ESM-only ("import" condition), so CJS require.resolve
// cannot see it. Locate the pnpm-hoisted producer copy by walking up from this
// test file to the workspace root.
function findProducerPackageRoot(): string {
  let dir = import.meta.dirname;
  while (true) {
    const candidate = join(dir, "node_modules", "@cf", "cf-cua", "package.json");
    if (existsSync(candidate)) return dirname(candidate);
    const parent = dirname(dir);
    if (parent === dir) throw new Error("workspace root not found from " + import.meta.dirname);
    dir = parent;
  }
}
const producerPackageRoot = findProducerPackageRoot();

const REQUIRED_EXPORTS = [
  "OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY",
  "OFFICIAL_CUA_IMAGE_INLINE_BASE64_BYTES",
  "containsOfficialCuaImageRefCredentialText",
  "isOfficialCuaImageRefText",
  "parseOfficialCuaImageRef",
  "containsImageRefAuthority",
  "preserveOfficialCuaFrameResult",
  "attestOfficialCuaFrameContent",
  "findOfficialCuaFrameContentPair",
  "readRasterEnvelopeIdentity",
] as const;

function runNodeImport(targetDir: string, specifier: string): string[] {
  const script = `import(${JSON.stringify(specifier)}).then((m) => console.log(JSON.stringify(Object.keys(m).sort())))`;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: targetDir,
    encoding: "utf8",
    env: { ...process.env, NODE_PATH: "" },
  });
  return JSON.parse(stdout.trim().split("\n").pop()!) as string[];
}

describe("producer frame-contract artifact resolution (SG-02)", () => {
  it("loads the installed subpath and exposes the full contract surface", () => {
    const keys = runNodeImport(producerPackageRoot, "@origin-ai/cf-cua/frame-contract");
    for (const name of REQUIRED_EXPORTS) {
      expect(keys, `missing export ${name}`).toContain(name);
    }
  });
});
