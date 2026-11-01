

import {
  Emitter,
  DisposableStore,
  IChannel,
  IPCServer,
  IPCClient,
  StaticRouter,
  ProxyChannel,
  createQueuePair,
  ClientConnectionEvent,
} from "../src/index.js";

// ============================================================================
// ============================================================================

class ConfigService {
  private config = new Map<string, any>();
  private readonly _onDidChange = new Emitter<{ key: string; value: any }>();
  readonly onDidChangeConfig = this._onDidChange.event;

  async get(key: string): Promise<any> {
    return this.config.get(key);
  }

  async set(key: string, value: any): Promise<void> {
    this.config.set(key, value);
    this._onDidChange.fire({ key, value });
  }
}

class WindowInfoService {
  constructor(private windowId: string) {}

  async getTitle(): Promise<string> {
    return `Window ${this.windowId}`;
  }

  async getSize(): Promise<{ width: number; height: number }> {
    return { width: 1920, height: 1080 };
  }
}

// ============================================================================
// ============================================================================

async function main() {
  console.log("--- IPCServer + IPCClient Demo ---\n");

  const disposables = new DisposableStore();

  const serverEmitter = new Emitter<ClientConnectionEvent>();
  const server = new IPCServer<string>(serverEmitter.event);

  const configService = new ConfigService();
  server.registerChannel("config", ProxyChannel.fromService<string>(configService, disposables));

  console.log('[1] Client "window-1" connecting...');

  const [proto1a, proto1b] = createQueuePair();
  const disconnectEmitter1 = new Emitter<void>();

  serverEmitter.fire({ protocol: proto1b, onDidClientDisconnect: disconnectEmitter1.event });
  const client1 = new IPCClient(proto1a, "window-1");

  client1.registerChannel(
    "windowInfo",
    ProxyChannel.fromService<string>(new WindowInfoService("window-1"), disposables),
  );

  console.log('[2] Client "window-2" connecting...');

  const [proto2a, proto2b] = createQueuePair();
  const disconnectEmitter2 = new Emitter<void>();

  serverEmitter.fire({ protocol: proto2b, onDidClientDisconnect: disconnectEmitter2.event });
  const client2 = new IPCClient(proto2a, "window-2");
  client2.registerChannel(
    "windowInfo",
    ProxyChannel.fromService<string>(new WindowInfoService("window-2"), disposables),
  );

  await new Promise((r) => setTimeout(r, 50));

  console.log("\n[3] Clients calling server...");

  const remoteConfig1 = ProxyChannel.toService<ConfigService>(client1.getChannel("config"));

  await remoteConfig1.set("theme", "dark");
  console.log(`  client1: set theme = "dark"`);

  const remoteConfig2 = ProxyChannel.toService<ConfigService>(client2.getChannel("config"));

  const theme = await remoteConfig2.get("theme");
  console.log(`  client2: get theme = "${theme}" (读到了 client1 Settings的Value！)`);

  console.log("\n[4] Server calling clients (reverse IPC)...");

  const window1Channel = server.getChannel<IChannel>(
    "windowInfo",
    new StaticRouter((ctx) => ctx === "window-1"),
  );
  const window1Info = ProxyChannel.toService<WindowInfoService>(window1Channel);
  const title1 = await window1Info.getTitle();
  console.log(`  server → window-1: title = "${title1}"`);

  const window2Channel = server.getChannel<IChannel>(
    "windowInfo",
    (client) => client.ctx === "window-2",
  );
  const window2Info = ProxyChannel.toService<WindowInfoService>(window2Channel);
  const title2 = await window2Info.getTitle();
  console.log(`  server → window-2: title = "${title2}"`);

  console.log(`\n[5] Active connections: ${server.connections.length}`);
  for (const conn of server.connections) {
    console.log(`  - ${conn.ctx}`);
  }

  console.log('\n[6] Client "window-1" disconnecting...');
  disconnectEmitter1.fire();
  await new Promise((r) => setTimeout(r, 10));

  console.log(`Active connections after disconnect: ${server.connections.length}`);
  for (const conn of server.connections) {
    console.log(`  - ${conn.ctx}`);
  }

  client1.dispose();
  client2.dispose();
  server.dispose();
  disposables.dispose();

  console.log("\nDone!");
}

main().catch(console.error);
