import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

describe("node_repl MCP bundle boundary", () => {
  it("Depends only on core REPL engine, excluding Agents, tools, or workflow compilers", async () => {
    const result = await build({
      absWorkingDir: packageRoot,
      bundle: true,
      entryPoints: ["src/server.ts"],
      format: "esm",
      legalComments: "none",
      metafile: true,
      platform: "node",
      target: "node24",
      write: false,
    });
    const inputs = Object.keys(result.metafile.inputs).map((path) =>
      normalizePath(resolve(packageRoot, path)),
    );
    const coreRoot = `${normalizePath(resolve(packageRoot, "../core/dist"))}/`;
    const coreInputs = inputs.filter((path) => path.startsWith(coreRoot));
    expect(coreInputs.length).toBeGreaterThan(0);
    expect(coreInputs.find((path) => !path.startsWith(`${coreRoot}repl/`))).toBeUndefined();
    expect(
      inputs.find((path) => /(?:^|\/)(?:dynamic-workflow|typescript)\//u.test(path)),
    ).toBeUndefined();

    const contractRoot = `${normalizePath(resolve(packageRoot, "../contracts/dist"))}/`;
    const contractInputs = inputs
      .filter((path) => path.startsWith(contractRoot))
      .map((path) => path.slice(contractRoot.length));
    expect(contractInputs.sort()).toEqual([
      "interfaces/mcp.port.js",
      "tools/json-schema.js",
      "tools/node-repl.js",
    ]);

    const sharedRoot = `${normalizePath(resolve(packageRoot, "../../../../packages/shared/src"))}/`;
    const sharedInputs = inputs.filter((path) => path.startsWith(sharedRoot));
    expect(sharedInputs.length).toBeGreaterThan(0);
    expect(
      sharedInputs.find((path) => !path.startsWith(`${sharedRoot}browser-use/`)),
    ).toBeUndefined();
  });
});
