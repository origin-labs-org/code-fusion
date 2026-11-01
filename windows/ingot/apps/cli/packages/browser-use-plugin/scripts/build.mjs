import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const defaultPackageRoot = resolve(import.meta.dirname, "..");
const executableFileMode = 0o755;

//   typeof require !== "undefined" ? require : (name) => { throw Error('Dynamic require of "' + name + '" is not supported') }
const nodeRequireBanner = `import { createRequire as __cfCreateRequire } from "node:module";
const require = __cfCreateRequire(import.meta.url);`;

const createBundleOptions = ({ entryPoint, outfile }) => ({
  banner: {
    js: nodeRequireBanner,
  },
  bundle: true,
  entryPoints: [entryPoint],
  format: "esm",
  legalComments: "none",
  outfile,
  platform: "node",
  target: "node24",
  external: ["sharp"],
});

export const buildBrowserUsePluginBundles = async ({
  packageRoot = defaultPackageRoot,
  browserClientOutfile = resolve(packageRoot, "scripts", "browser-client.mjs"),
} = {}) => {
  await mkdir(dirname(browserClientOutfile), { recursive: true });
  await build(
    createBundleOptions({
      entryPoint: resolve(packageRoot, "src", "browser-client.ts"),
      outfile: browserClientOutfile,
    }),
  );
  await chmod(browserClientOutfile, executableFileMode);
  return { browserClientOutfile };
};

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await buildBrowserUsePluginBundles();
}
