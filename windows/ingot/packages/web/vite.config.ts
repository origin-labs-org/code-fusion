import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { pdfJsCMapsPlugin } from "../ui/vite/pdfJsCMapsPlugin.js";
import { thirdPartyNoticesVitePlugin } from "../../scripts/third-party-notices.mjs";
import { resolveRemoteFrontendVersion } from "./vite/remoteFrontendVersion.mjs";
import {
  resolveBigModelApiOrigin,
  resolveRuntimeCfEndpointOrigin,
  resolveZaiOAuthClientId,
  resolveZaiOAuthOrigin,
} from "@origin-ai/cf-shared/cfEndpoint";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const { version, cfCompatibility } = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "package.json"), "utf-8"),
) as { version: string; cfCompatibility?: { minCompatibleVersion?: string } };
const minCompatibleVersion = cfCompatibility?.minCompatibleVersion ?? version;

function resolveCfEnv(value: string | undefined): "test" | "production" {
  return value?.trim().toLowerCase() === "production" ? "production" : "test";
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, REPO_ROOT, ""), ...process.env };
  const cfEnv = resolveCfEnv(env.CF_ENV);
  const endpointEnv = {
    ...env,
    CF_ENV: cfEnv,
  };
  const cfEndpointOrigin = resolveRuntimeCfEndpointOrigin(endpointEnv);
  const zaiOAuthOrigin = resolveZaiOAuthOrigin(endpointEnv);
  const bigmodelOAuthOrigin = resolveBigModelApiOrigin(endpointEnv);
  const zaiOAuthClientId = resolveZaiOAuthClientId(endpointEnv);

  return {
    plugins: [pdfJsCMapsPlugin(), react(), tailwindcss(), thirdPartyNoticesVitePlugin()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "../ui/src"),
        "d3-path": resolve(__dirname, "../../node_modules/d3-path/src/index.js"),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api/v1/oauth/token": {
          target: cfEndpointOrigin,
          changeOrigin: true,
          secure: true,
        },
        "/api/v1/remote": {
          target: cfEndpointOrigin,
          changeOrigin: true,
          secure: true,
          ws: true,
        },
        "/ws": { target: "ws://localhost:3030", ws: true },
        "/api": { target: "http://localhost:3030" },
      },
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    worker: {
      rollupOptions: {
        treeshake: false,
      },
    },
    define: {
      __CF_VERSION__: JSON.stringify(
        resolveRemoteFrontendVersion(version, process.env.WEB_REMOTE_FRONTEND_VERSION),
      ),
      __CF_MIN_COMPATIBLE_VERSION__: JSON.stringify(minCompatibleVersion),
      __CF_COMMIT__: JSON.stringify(env.CF_COMMIT || "unknown"),
      __CF_ENV__: JSON.stringify(cfEnv),
      "import.meta.env.VITE_CF_BASE_URL": JSON.stringify(cfEndpointOrigin),
      "import.meta.env.VITE_CF_ENDPOINT_ORIGIN": JSON.stringify(cfEndpointOrigin),
      "import.meta.env.VITE_ZAI_OAUTH_CLIENT_ID": JSON.stringify(zaiOAuthClientId),
      "import.meta.env.VITE_ZAI_OAUTH_ORIGIN": JSON.stringify(zaiOAuthOrigin),
      "import.meta.env.VITE_BIGMODEL_OAUTH_ORIGIN": JSON.stringify(bigmodelOAuthOrigin),
    },
    build: {
      sourcemap: mode === "production" ? "hidden" : true,
    },
  };
});
