
import { createSharedCfCredentialStore } from "../../src/auth/shared-credentials.js";
import { createMcpAdapter } from "../../src/mcp/index.js";
import { createMcpOAuthTokenProvider } from "../../src/mcp/oauth-provider.js";

interface DriverConfig {
  autoDrive?: boolean;
  credentialsPath: string;
  keyPrefix?: string;
  mcpUrl: string;
  mode: "refresh-race" | "authorize";
  secret: string;
  serverName?: string;
}

async function main(): Promise<void> {
  const config = JSON.parse(process.argv[2] ?? "{}") as DriverConfig;
  const credentialStore = createSharedCfCredentialStore({
    env: { CF_CREDENTIAL_SECRET: config.secret },
    filePath: config.credentialsPath,
  });

  if (config.mode === "refresh-race") {
    const provider = createMcpOAuthTokenProvider({
      config: { type: "authorization_code", scope: "mcp:tools" },
      credentialStore,
      keyPrefix: config.keyPrefix ?? "",
      serverName: "cross-process",
      serverUrl: config.mcpUrl,
    });
    const token = await provider.token();
    process.stdout.write(JSON.stringify({ token }));
    return;
  }

  const authorizationUrls: string[] = [];
  const adapter = createMcpAdapter({
    mcpOAuth: {
      credentialStore,
      ...(config.autoDrive
        ? {
            openAuthorizationUrl: async ({ authorizationUrl }) => {
              authorizationUrls.push(authorizationUrl);
              const response = await fetch(authorizationUrl, { redirect: "manual" });
              const location = response.headers.get("location");
              if (location) await fetch(location);
            },
          }
        : {}),
      onAuthorizationRequired: () => undefined,
    },
  });
  try {
    const status = await adapter.connectServer(config.serverName ?? "cross-process", {
      type: "http",
      url: config.mcpUrl,
      oauth: { type: "authorization_code", scope: "mcp:tools" },
    });
    process.stdout.write(JSON.stringify({ authorizationUrls, status }));
  } finally {
    await adapter.close();
  }
}

void main().then(
  () => undefined,
  (error: unknown) => {
    process.stderr.write(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  },
);
