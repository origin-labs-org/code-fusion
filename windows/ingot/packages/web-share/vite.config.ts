import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  resolveBigModelApiOrigin,
  resolveRuntimeCfEndpointOrigin,
  resolveZaiOAuthClientId,
  resolveZaiOAuthOrigin,
} from "../shared/src/cfEndpoint.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const { version } = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, REPO_ROOT, ""), ...process.env };
  const cfEnv = env.CF_ENV?.trim().toLowerCase() === "production" ? "production" : "test";
  const endpointEnv = { ...env, CF_ENV: cfEnv };
  const endpointOrigin = resolveRuntimeCfEndpointOrigin(endpointEnv);
  const oauthOrigin = resolveZaiOAuthOrigin(endpointEnv);
  const oauthClientId = resolveZaiOAuthClientId(endpointEnv);
  const bigmodelOAuthOrigin = resolveBigModelApiOrigin(endpointEnv);

  return {
    root: resolve(HERE),
    base: "/cn/share/",
    publicDir: resolve(REPO_ROOT, "packages/web/public"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        { find: "@", replacement: resolve(REPO_ROOT, "packages/ui/src") },
        {
          find: /^@cf\/shared$/,
          replacement: resolve(REPO_ROOT, "packages/shared/src/index.ts"),
        },
        {
          find: "@origin-ai/cf-ui/useTheme",
          replacement: resolve(REPO_ROOT, "packages/ui/src/useTheme.ts"),
        },
        {
          find: "@origin-ai/cf-shared/cf-protocol-v4",
          replacement: resolve(REPO_ROOT, "packages/shared/src/cf-protocol-v4/index.ts"),
        },
        {
          find: "@origin-ai/cf-shared/test-ids",
          replacement: resolve(REPO_ROOT, "packages/shared/src/test-ids.ts"),
        },
        {
          find: "@origin-ai/cf-ui/conversation-share-readonly",
          replacement: resolve(REPO_ROOT, "packages/share-ui/src/index.ts"),
        },
        {
          find: "@origin-ai/cf-ui/oauth-provider-icon",
          replacement: resolve(REPO_ROOT, "packages/ui/src/lib/oauthProviderIcon.tsx"),
        },
      ],
    },
    define: {
      __CF_VERSION__: JSON.stringify(version),
      __CF_COMMIT__: JSON.stringify(env.CF_COMMIT || "unknown"),
      __CF_ENV__: JSON.stringify(cfEnv),
      "import.meta.env.VITE_CF_BASE_URL": JSON.stringify(endpointOrigin),
      "import.meta.env.VITE_CF_ENDPOINT_ORIGIN": JSON.stringify(endpointOrigin),
      "import.meta.env.VITE_ZAI_OAUTH_CLIENT_ID": JSON.stringify(oauthClientId),
      "import.meta.env.VITE_ZAI_OAUTH_ORIGIN": JSON.stringify(oauthOrigin),
      "import.meta.env.VITE_BIGMODEL_OAUTH_ORIGIN": JSON.stringify(bigmodelOAuthOrigin),
    },
    build: {
      outDir: resolve(REPO_ROOT, "packages/web-share/dist"),
      emptyOutDir: true,
      sourcemap: mode === "production" ? "hidden" : true,
    },
  };
});
