import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolveCfEndpointOrigin } from "@origin-ai/cf-shared/cfEndpoint";
import { pdfJsCMapsPlugin } from "../ui/vite/pdfJsCMapsPlugin.js";
import { getBuildMetadata } from "./scripts/build-metadata.mjs";
import { resolveDesktopProductFlavor } from "./scripts/desktop-product-identity.mjs";

const { resolveBuildTimeConfig, createBuildTimeConfigDefines } = await import(
  pathToFileURL(resolve(__dirname, "../../scripts/build-time-config.mjs")).href
);
const buildTimeConfigDefines = createBuildTimeConfigDefines(
  await resolveBuildTimeConfig(process.env),
);

const buildMetadata = getBuildMetadata();
const desktopRequire = createRequire(import.meta.url);

interface IstanbulInstrumenter {
  instrumentSync(sourceCode: string, filename: string): string;
  lastFileCoverage(): unknown;
  lastSourceMap(): object | null;
}

interface IstanbulLibInstrument {
  createInstrumenter(options: {
    autoWrap: boolean;
    compact: boolean;
    coverageGlobalScope: string;
    coverageGlobalScopeFunc: boolean;
    esModules: boolean;
    parserPlugins: string[];
    preserveComments: boolean;
    produceSourceMap: boolean;
  }): IstanbulInstrumenter;
}

const { createInstrumenter } = desktopRequire("istanbul-lib-instrument") as IstanbulLibInstrument;

function resolveInstalledPackageRoot(packageName: string): string {
  return dirname(desktopRequire.resolve(`${packageName}/package.json`));
}

export const desktopRendererDependencyAliases = {
  react: resolveInstalledPackageRoot("react"),
  "react-dom": resolveInstalledPackageRoot("react-dom"),
  "lucide-react": resolveInstalledPackageRoot("lucide-react"),
} as const;

function resolveCfEnv(value: string | undefined): "test" | "production" {
  return value?.trim().toLowerCase() === "production" ? "production" : "test";
}

function createE2EUIRendererCoveragePlugin(repoRoot: string): Plugin {
  const sourceRoots = [
    resolve(repoRoot, "packages/ui/src"),
    resolve(repoRoot, "packages/desktop/src/renderer"),
  ].map(normalizePathForVite);
  const instrumenter = createInstrumenter({
    autoWrap: true,
    compact: false,
    coverageGlobalScope: "globalThis",
    coverageGlobalScopeFunc: false,
    esModules: true,
    parserPlugins: ["typescript", "jsx"],
    preserveComments: true,
    produceSourceMap: true,
  });
  const baselineCoverage: Record<string, unknown> = {};
  const baselinePath = resolve(
    repoRoot,
    "packages/desktop/out/renderer/e2e-coverage-baseline.json",
  );

  return {
    name: "cf:e2e-ui-source-coverage",
    enforce: "pre",
    transform(sourceCode, id, options) {
      if (options?.ssr || id.startsWith("\0")) {
        return null;
      }
      const filename = stripViteRequestQuery(id);
      const absoluteFilename = isAbsolute(filename) ? filename : resolve(repoRoot, filename);
      const normalizedFilename = normalizePathForVite(absoluteFilename);
      if (!shouldInstrumentE2EUISource(normalizedFilename, sourceRoots)) {
        return null;
      }

      const code = instrumenter.instrumentSync(sourceCode, normalizedFilename);
      baselineCoverage[normalizedFilename] = JSON.parse(
        JSON.stringify(instrumenter.lastFileCoverage()),
      );
      return {
        code,
        map: instrumenter.lastSourceMap(),
      };
    },
    closeBundle() {
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, `${JSON.stringify(baselineCoverage, null, 2)}\n`, "utf-8");
    },
  };
}

function shouldInstrumentE2EUISource(filename: string, sourceRoots: string[]) {
  return (
    isCoverageSourceFile(filename) &&
    !filename.includes("/node_modules/") &&
    !isDeclarationFile(filename) &&
    !isTestSourceFile(filename) &&
    sourceRoots.some((sourceRoot) => isInsidePath(filename, sourceRoot))
  );
}

function isCoverageSourceFile(filename: string) {
  return [".cts", ".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"].includes(extname(filename));
}

function isDeclarationFile(filename: string) {
  return /\.d\.[cm]?ts$/u.test(filename);
}

function isTestSourceFile(filename: string) {
  return /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(filename);
}

function isInsidePath(filename: string, directory: string) {
  return filename === directory || filename.startsWith(`${directory}/`);
}

function normalizePathForVite(path: string) {
  return path.replaceAll("\\", "/");
}

function stripViteRequestQuery(id: string) {
  return id.split("?")[0] ?? id;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const repoRoot = resolve(__dirname, "../..");
  const cfEnv = resolveCfEnv(env.CF_ENV);
  const cfProductFlavor = resolveDesktopProductFlavor({
    ...process.env,
    ...env,
    CF_ENV: cfEnv,
  });
  const e2eCoverageEnabled =
    env.CF_E2E_COVERAGE === "1" || process.env.CF_E2E_COVERAGE === "1";
  const e2eStoreBridgeEnabled =
    env.VITE_CF_E2E_STORE_BRIDGE === "1" || process.env.VITE_CF_E2E_STORE_BRIDGE === "1";
  const cfEndpointOrigin = resolveCfEndpointOrigin({
    env: cfEnv,
    envBaseOrigin:
      env.CF_BASE_URL ??
      env.CF_ENDPOINT_ORIGIN ??
      (cfEnv === "production" ? env.CF_PRODUCTION_BASE_URL : env.CF_TEST_BASE_URL),
  });
  const codingPlanWebviewOrigin =
    env.VITE_CODING_PLAN_WEBVIEW_ORIGIN ?? process.env.VITE_CODING_PLAN_WEBVIEW_ORIGIN ?? "";
  const plugins = [
    ...(e2eCoverageEnabled ? [createE2EUIRendererCoveragePlugin(repoRoot)] : []),
    pdfJsCMapsPlugin(),
    react(),
    tailwindcss(),
  ];

  return {
    root: "src/renderer",
    plugins,
    resolve: {
      alias: {
        "@": resolve(__dirname, "../ui/src"),
        ...desktopRendererDependencyAliases,
        "d3-path": resolve(__dirname, "../../node_modules/d3-path/src/index.js"),
      },
      dedupe: ["react", "react-dom", "lucide-react"],
    },
    server: { port: 5174, strictPort: true },
    define: {
      __CF_VERSION__: JSON.stringify(buildMetadata.appVersion),
      __CF_MIN_COMPATIBLE_VERSION__: JSON.stringify(buildMetadata.minCompatibleVersion),
      __CF_COMMIT__: JSON.stringify(buildMetadata.buildCommitId),
      __CF_BUILD_TIME__: JSON.stringify(buildMetadata.buildTime),
      __CF_ENV__: JSON.stringify(cfEnv),
      __CF_PRODUCT_FLAVOR__: JSON.stringify(cfProductFlavor),
      ...buildTimeConfigDefines,
      __CF_LOCAL_DEVELOPMENT_RUNTIME__: JSON.stringify(mode !== "production"),
      "import.meta.env.VITE_CF_BASE_URL": JSON.stringify(cfEndpointOrigin),
      "import.meta.env.VITE_CF_ENDPOINT_ORIGIN": JSON.stringify(cfEndpointOrigin),
      "import.meta.env.VITE_CODING_PLAN_WEBVIEW_ORIGIN": JSON.stringify(codingPlanWebviewOrigin),
      "import.meta.env.VITE_REWARDS_WEBVIEW_ORIGIN": JSON.stringify(env.VITE_REWARDS_WEBVIEW_ORIGIN ?? process.env.VITE_REWARDS_WEBVIEW_ORIGIN ?? ""),
      "import.meta.env.VITE_CF_E2E_STORE_BRIDGE": JSON.stringify(
        e2eStoreBridgeEnabled ? "1" : "",
      ),
    },
    base: "./",
    worker: {
      rollupOptions: {
        treeshake: false,
      },
    },
    build: {
      outDir: "../../out/renderer",
      emptyOutDir: true,
      sourcemap: mode === "production" ? "hidden" : true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          "resource-manager": resolve(__dirname, "src/renderer/resource-manager.html"),
          "cua-permission-panel": resolve(__dirname, "src/renderer/cua-permission-panel.html"),
          "plugin-sandbox": resolve(__dirname, "src/renderer/plugin-sandbox.html"),
        },
      },
    },
  };
});
