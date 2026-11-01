import { chmod, readFile, rm } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import sharedPackage from "../../../../../packages/shared/package.json" with { type: "json" };
import { stageBuiltinProviderConfig } from "../../../../../scripts/builtin-provider-config.mjs";
import { stageThirdPartyNotices } from "../../../../../scripts/third-party-notices.mjs";

const cliRoot = resolve(import.meta.dirname, "..");
const projectRoot = resolve(cliRoot, "../..");
const executableFileMode = 0o755;
const packageJsonFile = "package.json";
const rootPackageVersionError = "Root package.json must define a non-empty string version.";
const desktopAgentBuildFlag = "--desktop-agent";
export const resolveBuildExternal = () => ["@origin-ai/cf-tui", "playwright-core", "koffi"];

export const readZodBuildVersion = async () => {
  const sharedPackage = JSON.parse(
    await readFile(resolve(projectRoot, "../../packages/shared/package.json"), "utf8"),
  );
  const version = sharedPackage.dependencies?.zod;
  if (typeof version !== "string" || !/^4\.\d+\.\d+$/.test(version)) {
    throw new Error("packages/shared must pin one exact Zod v4 version.");
  }
  return version;
};

async function readZodPackage(file, cache) {
  for (
    let directory = dirname(file);
    directory !== dirname(directory);
    directory = dirname(directory)
  ) {
    if (basename(directory) !== "zod") continue;
    if (!cache.has(directory)) {
      cache.set(
        directory,
        readFile(resolve(directory, "package.json"), "utf8").then((text) => {
          const manifest = JSON.parse(text);
          if (manifest.name !== "zod" || typeof manifest.version !== "string") {
            throw new Error(`Invalid Zod package metadata: ${directory}`);
          }
          return { root: directory, version: manifest.version };
        }),
      );
    }
    return cache.get(directory);
  }
  return undefined;
}

function assertZodVersion(pkg, expectedV4Version) {
  if (pkg.version.startsWith("4.") && pkg.version !== expectedV4Version) {
    throw new Error(`Expected Zod v4 ${expectedV4Version}, found ${pkg.version}: ${pkg.root}`);
  }
}

export async function assertZodBundleIdentity(metafile, { workingDirectory, expectedV4Version }) {
  if (!metafile) throw new Error("Zod bundle validation requires an esbuild metafile.");
  const packages = new Map();
  const cache = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    if (!/(?:^|[/\\])zod[/\\]/.test(input)) continue;
    const pkg = await readZodPackage(resolve(workingDirectory, input), cache);
    if (!pkg) continue;
    assertZodVersion(pkg, expectedV4Version);
    const previous = packages.get(pkg.version);
    if (previous && previous !== pkg.root) {
      throw new Error(`Duplicate Zod ${pkg.version} in bundle: ${previous}, ${pkg.root}`);
    }
    packages.set(pkg.version, pkg.root);
  }
}

export function createZodDedupePlugin({ expectedV4Version }) {
  return {
    name: "cf-zod-dedupe",
    setup(builder) {
      const packages = new Map();
      const cache = new Map();
      builder.onResolve({ filter: /^zod(?:\/|$)/ }, async (args) => {
        if (args.pluginData?.cfZodResolving) return;
        const resolved = await builder.resolve(args.path, {
          importer: args.importer,
          resolveDir: args.resolveDir,
          kind: args.kind,
          pluginData: { cfZodResolving: true },
        });
        if (resolved.errors.length || resolved.external) return resolved;
        const pkg = await readZodPackage(resolved.path, cache);
        if (!pkg) throw new Error(`Cannot identify resolved Zod package: ${resolved.path}`);
        assertZodVersion(pkg, expectedV4Version);
        if (!packages.has(pkg.version)) packages.set(pkg.version, pkg.root);
        return {
          ...resolved,
          path: resolve(packages.get(pkg.version), relative(pkg.root, resolved.path)),
          pluginData: args.pluginData,
        };
      });
      builder.onEnd(async (result) => {
        if (result.errors.length) return;
        await assertZodBundleIdentity(result.metafile, {
          workingDirectory: builder.initialOptions.absWorkingDir ?? process.cwd(),
          expectedV4Version,
        });
      });
    },
  };
}

export const readRootPackageVersion = async ({ root = projectRoot } = {}) => {
  const packageJson = JSON.parse(await readFile(resolve(root, packageJsonFile), "utf8"));

  if (typeof packageJson.version !== "string" || packageJson.version.trim() === "") {
    throw new Error(rootPackageVersionError);
  }

  return packageJson.version;
};

export const resolveBuildOptions = (args = [], env = process.env) => {
  const desktopAgent = args.includes(desktopAgentBuildFlag);
  const e2eCoverage = env.CF_E2E_COVERAGE === "1";

  return {
    minify: desktopAgent && !e2eCoverage,
    sourcemap: e2eCoverage || !desktopAgent,
  };
};

export const resolveBuildAliases = ({
  cliDirectory = cliRoot,
  rootDirectory = projectRoot,
} = {}) => ({
  "@origin-ai/cf-shared-types": resolve(cliDirectory, "../shared-types/dist/index.js"),
  ...Object.fromEntries(
    Object.entries(sharedPackage.exports)
      .sort(([a], [b]) => Number(a === ".") - Number(b === "."))
      .map(([subpath, target]) => [
        subpath === "." ? "@origin-ai/cf-shared" : `@origin-ai/cf-shared/${subpath.slice(2)}`,
        resolve(rootDirectory, "../../packages/shared", target),
      ]),
  ),
  "@origin-ai/cf-core": resolve(cliDirectory, "../core/dist/index.js"),
});

export const buildCli = async ({
  cliDirectory = cliRoot,
  rootDirectory = projectRoot,
  minify = false,
  sourcemap = true,
  env = process.env,
  version = readRootPackageVersion({
    root: rootDirectory,
  }),
} = {}) => {
  const cliVersion = await version;
  const outfile = resolve(cliDirectory, "dist/cf.cjs");
  const sourcemapFile = `${outfile}.map`;

  await stageBuiltinProviderConfig({
    root: resolve(rootDirectory, "../.."),
    directory: resolve(cliDirectory, "dist/provider"),
    env,
  });

  await build({
    banner: {
      js: "#!/usr/bin/env node",
    },
    bundle: true,
    define: {
      __CLI_VERSION__: JSON.stringify(cliVersion),
    },
    entryPoints: [resolve(cliDirectory, "src/main.ts")],
    // Ink 7 and yoga-layout use top-level await, so the CJS CLI bundle loads the TUI
    // through Node's native dynamic import path instead of forcing esbuild to lower it.
    external: resolveBuildExternal(),
    format: "cjs",
    keepNames: minify,
    legalComments: "none",
    logLevel: "info",
    minify,
    metafile: true,
    plugins: [createZodDedupePlugin({ expectedV4Version: await readZodBuildVersion() })],
    outfile,
    platform: "node",
    sourcemap,
    target: "node22",
    alias: resolveBuildAliases({ cliDirectory, rootDirectory }),
  });

  if (!sourcemap) {
    await rm(sourcemapFile, { force: true });
  }

  await chmod(outfile, executableFileMode);
  await stageThirdPartyNotices(resolve(cliDirectory, "dist"), resolve(rootDirectory, "../.."));
};

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  await buildCli(resolveBuildOptions(process.argv.slice(2)));
}
