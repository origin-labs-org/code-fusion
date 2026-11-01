import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(import.meta.dirname, "..");

const nodeRequireBanner = `import { createRequire as __cfCreateRequire } from "node:module";
const require = __cfCreateRequire(import.meta.url);`;

// 「permission broker socket is not accepting connections yet」。
//
//
//   "Packaged CodeFusion is missing its embedded Computer Use Helper build identity;
//    refusing an unpinned Helper install"
//
//
const resolveCuaHelperBuildId = (env = process.env) =>
  env.CF_CUA_HELPER_BUILD_ID?.trim() ?? "";

export const buildNodeReplHostBundle = async ({
  outfile = resolve(packageRoot, "dist", "mcp", "server.js"),
  cuaHelperBuildId = resolveCuaHelperBuildId(),
} = {}) => {
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    banner: { js: nodeRequireBanner },
    bundle: true,
    define: {
      __CF_CUA_HELPER_BUILD_ID__: JSON.stringify(cuaHelperBuildId),
    },
    entryPoints: [resolve(packageRoot, "src", "server.ts")],
    format: "esm",
    legalComments: "none",
    outfile,
    platform: "node",
    target: "node24",
    external: ["sharp"],
  });
  if (cuaHelperBuildId) {
    const bundled = await readFile(outfile, "utf8");
    if (!bundled.includes(cuaHelperBuildId)) {
      throw new Error(
        `[node-repl-host] CF_CUA_HELPER_BUILD_ID=${cuaHelperBuildId} 未折叠进 ${outfile}：` +
          "__CF_CUA_HELPER_BUILD_ID__ define not effective; Helper installation in production packages will be rejected (fail-closed).",
      );
    }
  }
  return { outfile, cuaHelperBuildId };
};

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const { outfile } = await buildNodeReplHostBundle();
  console.log(`[node-repl-host] ${outfile}`);
}
