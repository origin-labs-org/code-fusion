import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "tsup";
const { loadBuiltinProviderConfig } = await import(
  pathToFileURL(resolve(import.meta.dirname, "../../scripts/builtin-provider-config.mjs")).href
);
const { stageThirdPartyNotices } = await import(
  pathToFileURL(resolve(import.meta.dirname, "../../scripts/third-party-notices.mjs")).href
);

const rootPackageJsonPath = resolve(import.meta.dirname, "../../package.json");
const { version, cfCompatibility } = JSON.parse(readFileSync(rootPackageJsonPath, "utf-8")) as {
  version: string;
  cfCompatibility?: { minCompatibleVersion?: string };
};
const minCompatibleVersion = cfCompatibility?.minCompatibleVersion ?? version;

const { environment: cfEnv, content: cfBuiltinProviderConfigJson } =
  await loadBuiltinProviderConfig();

export const SERVER_HTTP_DEFINES = {
  __CF_VERSION__: JSON.stringify(version),
  __CF_MIN_COMPATIBLE_VERSION__: JSON.stringify(minCompatibleVersion),
  __CF_ENV__: JSON.stringify(cfEnv),
  __CF_BUILTIN_PROVIDER_CONFIG_JSON__: JSON.stringify(cfBuiltinProviderConfigJson),
};

function createSharedDefines() {
  return SERVER_HTTP_DEFINES;
}

export const SERVER_HTTP_EXTERNAL_DEPENDENCIES = [
  "ssh2",
  "node-pty",
  "undici",
  "axios",
  "form-data",
  "combined-stream",
  "proxy-from-env",
  "follow-redirects",
  "yazl",
  "node-forge",
  "yaml",
  "yazl",
  "node-forge",
  "yauzl",
];

export default defineConfig({
  onSuccess: async () => {
    await stageThirdPartyNotices(resolve(import.meta.dirname, "dist"));
  },
  entry: { "entry-http": "src/entry-http.ts" },
  outDir: "dist",
  format: "esm",
  platform: "node",
  removeNodeProtocol: false,
  target: "node22",
  noExternal: [
    "@origin-ai/cf-shared",
    "@origin-ai/cf-rpc",
    "@origin-ai/cf-services",
    "@origin-ai/cf-services/node",
    "@origin-ai/cf-client",
  ],
  external: SERVER_HTTP_EXTERNAL_DEPENDENCIES,
  define: createSharedDefines(),
  tsconfig: "tsconfig.build.json",
});
