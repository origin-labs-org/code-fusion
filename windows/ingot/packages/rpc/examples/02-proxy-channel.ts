

import {
  Emitter,
  Event,
  DisposableStore,
  ChannelServer,
  ChannelClient,
  ProxyChannel,
  createQueuePair,
} from "../src/index.js";

// ============================================================================
// ============================================================================

interface IFileService {
  onDidChangeFile: Event<{ path: string; type: string }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listFiles(dir: string): Promise<string[]>;
}

class InMemoryFileService implements IFileService {
  private files = new Map<string, string>();
  private readonly _onDidChangeFile = new Emitter<{ path: string; type: string }>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const isNew = !this.files.has(path);
    this.files.set(path, content);
    this._onDidChangeFile.fire({
      path,
      type: isNew ? "created" : "changed",
    });
  }

  async listFiles(dir: string): Promise<string[]> {
    return [...this.files.keys()].filter((p) => p.startsWith(dir));
  }
}

// ============================================================================
// ============================================================================

async function main() {
  const [protocolA, protocolB] = createQueuePair();
  const disposables = new DisposableStore();

  const fileService = new InMemoryFileService();

  const channel = ProxyChannel.fromService<string>(fileService, disposables);

  const server = new ChannelServer(protocolB, "server");
  server.registerChannel("fileService", channel);

  const client = new ChannelClient(protocolA);
  await Event.toPromise(client.onDidInitialize);

  const remoteFS = ProxyChannel.toService<IFileService>(client.getChannel("fileService"));

  console.log("--- ProxyChannel Demo ---");
  console.log("（注意：所有调用都经过了序列化 → 传输 → 反序列化）\n");

  const eventDisposable = remoteFS.onDidChangeFile((e) => {
    console.log(`  [file event] ${e.type}: ${e.path}`);
  });

  await remoteFS.writeFile("/src/main.ts", 'console.log("hello")');
  await remoteFS.writeFile("/src/util.ts", "export function add(a, b) { return a + b; }");
  await remoteFS.writeFile("/src/main.ts", 'console.log("hello world")');

  const content = await remoteFS.readFile("/src/main.ts");
  console.log(`\nreadFile('/src/main.ts') = "${content}"`);

  const files = await remoteFS.listFiles("/src");
  console.log(`listFiles('/src') = ${JSON.stringify(files)}`);

  try {
    await remoteFS.readFile("/nonexistent");
  } catch (err: any) {
    console.log(`readFile('/nonexistent') → Error: ${err.message}`);
  }

  eventDisposable.dispose();
  client.dispose();
  server.dispose();
  disposables.dispose();

  console.log("\nDone!");
}

main().catch(console.error);
