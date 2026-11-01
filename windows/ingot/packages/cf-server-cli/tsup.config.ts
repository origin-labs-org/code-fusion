import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const rootPackageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
) as { version: string; cfCompatibility?: { minCompatibleVersion?: string } };
const minCompatibleVersion =
  rootPackageJson.cfCompatibility?.minCompatibleVersion ?? rootPackageJson.version;

const { loadBuiltinProviderConfig } = await import(
  pathToFileURL(resolve(import.meta.dirname, "../../scripts/builtin-provider-config.mjs")).href
);

const { content: cfBuiltinProviderConfigJson } = await loadBuiltinProviderConfig();

export const SERVER_CLI_DEFINES = {
  __CF_VERSION__: JSON.stringify(rootPackageJson.version),
  __CF_MIN_COMPATIBLE_VERSION__: JSON.stringify(minCompatibleVersion),
  __CF_BUILTIN_PROVIDER_CONFIG_JSON__: JSON.stringify(cfBuiltinProviderConfigJson),
};

export default defineConfig({
  entry: {
    "server-cli": "src/main.ts",
    "server-core": "src/server-core/entry.ts",
  },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  removeNodeProtocol: false,
  target: "node22",
  sourcemap: true,
  splitting: false,
  banner: {
    js: 'import { fileURLToPath as __cfFileURLToPath } from "node:url"; import { dirname as __cfDirname } from "node:path"; const __filename = __cfFileURLToPath(import.meta.url); const __dirname = __cfDirname(__filename);',
  },
  noExternal: ["@origin-ai/cf-shared", "@origin-ai/cf-rpc", "@origin-ai/cf-services"],
  define: SERVER_CLI_DEFINES,
  external: [
    "node-pty",
    "ssh2",
    "yaml",
    "yazl",
    "node-forge",
    "undici",
    "axios",
    "form-data",
    "combined-stream",
    "proxy-from-env",
    "follow-redirects",
    "@lydell/node-pty-darwin-arm64",
    "@lydell/node-pty-darwin-x64",
    "@lydell/node-pty-linux-arm64",
    "@lydell/node-pty-linux-x64",
  ],
});
