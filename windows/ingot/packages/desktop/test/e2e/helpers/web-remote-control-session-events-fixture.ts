import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { createFakeRelayV2 } from "@origin-ai/cf-shared/testing/fake-relay-v2";

export const WEB_REMOTE_CONTROL_FIXTURE_CREDENTIALS = {
  "oauth:active_provider": "zai",
  "oauth:zai:access_token": "mock-token",
  "oauth:zai:user_info": JSON.stringify({
    id: "cf-e2e-user",
    username: "CodeFusion E2E",
    displayName: "CodeFusion E2E",
  }),
  cfjwttoken: "mock-token",
};

export async function prepareWebRemoteControlSessionEventsFixture(options: {
  credentialsFile: string;
  settingsFile: string;
  workspacePath: string;
  webUrl?: string;
}): Promise<() => Promise<void>> {
  const relay = await createFakeRelayV2({
    users: { "mock-token": "cf-e2e-user" },
    onHttp: (call) => {
      if (call.path.startsWith("/api/v1/remote/")) return;
      if (call.path === "/api/v1/client/scenes")
        return { status: 200, body: { code: 0, msg: "", data: [] } };
      if (options.webUrl && !call.path.includes("config"))
        return {
          status: 503,
          body: { code: 503, msg: "not configured in mobile file-navigation fixture" },
        };
      return {
        status: 200,
        body: {
          code: 0,
          data: { configs: {}, builtinModels: [], config_version: "session-events" },
        },
      };
    },
  });
  const envPatch = {
    ...(options.webUrl ? { VITE_CF_E2E_STORE_BRIDGE: "1" } : {}),
    ZAI_BUSINESS_BASE_URL: relay.httpUrl,
    CF_E2E_REMOTE_AUTH_GATE_URL: relay.httpUrl,
    CF_BASE_URL: relay.httpUrl,
    CF_ENDPOINT_ORIGIN: relay.httpUrl,
    CF_TEST_BASE_URL: relay.httpUrl,
    CF_WEB_REMOTE_CONTROL_RELAY_WS_URL: relay.wsUrl,
    CF_WEB_REMOTE_CONTROL_URL: options.webUrl ?? `${relay.httpUrl}/remote/v4`,
  };
  const previous = Object.fromEntries(Object.keys(envPatch).map((key) => [key, process.env[key]]));
  Object.assign(process.env, envPatch);
  const web = options.webUrl
    ? spawn(
        process.execPath,
        [
          resolve(import.meta.dirname, "../../../../../node_modules/vite/bin/vite.js"),
          "--host",
          "127.0.0.1",
          "--port",
          "5173",
          "--strictPort",
        ],
        {
          cwd: resolve(import.meta.dirname, "../../../../../packages/web"),
          env: { ...process.env, NO_COLOR: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
    : undefined;
  if (web) {
    await new Promise<void>((resolveReady, reject) => {
      web.once("error", reject);
      web.once("exit", (code) =>
        reject(new Error(`Mobile Web fixture exited before ready: ${code}`)),
      );
      web.stdout.on("data", (chunk) => {
        if (String(chunk).includes("http://127.0.0.1:5173")) resolveReady();
      });
      web.stderr.on("data", (chunk) => process.stderr.write(chunk));
    });
  }
  await writeFile(options.credentialsFile, JSON.stringify(WEB_REMOTE_CONTROL_FIXTURE_CREDENTIALS), {
    mode: 0o600,
  });
  const settings = JSON.parse(await readFile(options.settingsFile, "utf8"));
  await writeFile(
    options.settingsFile,
    JSON.stringify({
      ...settings,
      cfEndpointOrigin: relay.httpUrl,
      webRemoteControlLastEnabledContext: { workspacePath: options.workspacePath },
    }),
  );
  return async () => {
    if (web && web.exitCode === null) {
      const exited = once(web, "exit");
      web.kill();
      await exited;
    }
    await relay.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
