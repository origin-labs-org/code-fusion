import { migrateApplicationStorage, createSettingService } from "@origin-ai/cf-services/node";
import { disposeServiceResourcesAndWait, getAppConfigDir } from "@origin-ai/cf-services/node";
import type { IChannel } from "@origin-ai/cf-rpc";
import {
  CF_VERSION,
  TOPIC_RESOURCE_RELAY_CHANNEL,
  SERVICE_AUTHORITY_MODE_ENV,
  formatLogPrefix,
  formatZodError,
  helloAckMessageSchema,
} from "@origin-ai/cf-shared";
import type { HelloMessage, HelloAckMessage } from "@origin-ai/cf-shared";
import { createStdioServer } from "./stdio.js";
import { registerStdioProcessLifecycle } from "./stdio-lifecycle.js";
import { createStdioServices } from "./stdioServices.js";
import { ensureRemoteServerDeviceMid } from "./stdioDeviceMid.js";
import {
  materializeBundledCfBuiltinProviderConfig,
  readBundledCfBuiltinProviderConfig,
} from "./bundledCfBuiltinProviderConfig.js";

// In stdio mode, all logging goes to stderr
const log = (...args: unknown[]) =>
  console.error(formatLogPrefix("cf-server:stdio", process.pid), ...args);
const stderrConsoleLog = (...args: unknown[]) => console.error(...args);

console.log = stderrConsoleLog;
console.info = stderrConsoleLog;
console.warn = stderrConsoleLog;
console.debug = stderrConsoleLog;

// --version flag: print version and exit (used by deploy version check)
if (process.argv.includes("--version")) {
  process.stdout.write(CF_VERSION + "\n");
  process.exit(0);
}

async function main() {
  // Phase 1: Send hello message
  const hello: HelloMessage = {
    type: "cf-hello",
    version: CF_VERSION,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
  };
  process.stdout.write(JSON.stringify(hello) + "\n");

  // Phase 2: Wait for hello-ack
  const ack = await waitForAck();
  log(`client connected: ${ack.clientId} (v${ack.version})`);

  await ensureRemoteServerDeviceMid({ log });

  // Phase 3: Initialize services and start stdio RPC server
  let topicResourceChannel: IChannel | undefined;
  const cfBuiltinProviderConfigFilePath = await materializeBundledCfBuiltinProviderConfig({
    environmentConfigRoot: getAppConfigDir(),
    content: readBundledCfBuiltinProviderConfig(),
  });
  await migrateApplicationStorage(await createSettingService().get());
  const { authorityModeParseResult, services } = createStdioServices({
    env: process.env,
    cfBuiltinProviderConfigFilePath,
    topicResourceRelayChannel: () => {
      if (!topicResourceChannel) throw new Error("Desktop topic resource channel is unavailable");
      return topicResourceChannel;
    },
  });
  if (authorityModeParseResult.invalidRawValue) {
    log(
      `${SERVICE_AUTHORITY_MODE_ENV}=${authorityModeParseResult.invalidRawValue} 非法，按DefaultLocal machine Environment 权威ModeStart`,
    );
  }
  const stdioServer = createStdioServer(
    services,
    authorityModeParseResult.mode === "desktop-attached-remote"
      ? (client) => {
          topicResourceChannel = client.getChannel(TOPIC_RESOURCE_RELAY_CHANNEL);
        }
      : undefined,
  );
  registerStdioProcessLifecycle({
    stdin: process.stdin,
    signalSource: process,
    log,
    stopRpc: () => stdioServer.stop(),
    dispose: () => disposeServiceResourcesAndWait(services),
    exit: (code) => process.exit(code),
  });
  log("stdio mode ready");
}

function waitForAck(): Promise<HelloAckMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Handshake timeout: no hello-ack received within 10s"));
    }, 10_000);

    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        // Remove listener — remaining data in buffer will be consumed by RPC
        process.stdin.removeListener("data", onData);
        clearTimeout(timeout);

        try {
          const rawValue = JSON.parse(line);
          const result = helloAckMessageSchema.safeParse(rawValue);
          if (!result.success) {
            reject(new Error(`Invalid hello-ack: ${formatZodError(result.error)}`));
            return;
          }
          const msg = result.data as HelloAckMessage;
          // If there's remaining data after the newline, push it back
          const remaining = buffer.slice(newlineIdx + 1);
          if (remaining.length > 0) {
            process.stdin.unshift(Buffer.from(remaining, "utf-8"));
          }
          resolve(msg);
        } catch (err) {
          reject(new Error(`Failed to parse hello-ack: ${err}`));
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

main().catch((err) => {
  log("fatal:", err);
  process.exit(1);
});
