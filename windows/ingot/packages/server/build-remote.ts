import { readFileSync } from "node:fs";
import { build, type Plugin } from "esbuild";
import { validateRemoteServerBundle } from "./buildRemoteValidation.js";
import { loadBuiltinProviderConfig } from "../../scripts/builtin-provider-config.mjs";
import { stageThirdPartyNotices } from "../../scripts/third-party-notices.mjs";

const { version, cfCompatibility } = JSON.parse(readFileSync("../../package.json", "utf-8")) as {
  version: string;
  cfCompatibility?: { minCompatibleVersion?: string };
};
const minCompatibleVersion = cfCompatibility?.minCompatibleVersion ?? version;
const { content: cfBuiltinProviderConfigJson } = await loadBuiltinProviderConfig();

const nativeAddonPlugin: Plugin = {
  name: "native-addon",
  setup(build) {
    // Mark all .node files as external — they can't be bundled
    build.onResolve({ filter: /\.node$/ }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

const buildResult = await build({
  entryPoints: ["src/entry-stdio.ts"],
  bundle: true,
  outfile: "dist/remote/cf-server.cjs",
  platform: "node",
  format: "cjs",
  target: "node22",
  plugins: [nativeAddonPlugin],
  banner: {
    js: 'var __import_meta_url = require("url").pathToFileURL(__filename).href; var __import_meta_dirname = __dirname;',
  },
  define: {
    "import.meta.url": "__import_meta_url",
    "import.meta.dirname": "__import_meta_dirname",
    __CF_VERSION__: JSON.stringify(version),
    __CF_MIN_COMPATIBLE_VERSION__: JSON.stringify(minCompatibleVersion),
    __CF_BUILTIN_PROVIDER_CONFIG_JSON__: JSON.stringify(cfBuiltinProviderConfigJson),
  },
  metafile: true,
});

const remoteBundleSource = readFileSync("dist/remote/cf-server.cjs", "utf-8");
const bundledInputs = Object.keys(buildResult.metafile.inputs);
validateRemoteServerBundle({ bundledInputs, source: remoteBundleSource });
await stageThirdPartyNotices("dist/remote");

console.log("Built dist/remote/cf-server.cjs");
