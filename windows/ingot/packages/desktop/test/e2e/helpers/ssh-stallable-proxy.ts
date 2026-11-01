import { createConnection, createServer, type AddressInfo, type Socket } from "node:net";

export async function createStallableTcpProxy(target: { host: string; port: number }) {
  const pending = new Map<
    Socket,
    { chunks: Buffer[]; capture: (chunk: Buffer) => void; cleanup: () => void }
  >();
  const live = new Set<Socket>();
  let mode: "forward" | "stall" | "reject" = "forward";
  let accepted = 0;
  const attach = (client: Socket, initial: readonly Buffer[] = []) => {
    client.pause();
    const upstream = createConnection({ host: target.host, port: target.port });
    live.add(client);
    live.add(upstream);
    const closeBoth = () => {
      client.destroy();
      upstream.destroy();
      live.delete(client);
      live.delete(upstream);
    };
    client.once("error", closeBoth);
    upstream.once("error", closeBoth);
    upstream.once("connect", () => {
      for (const chunk of initial) upstream.write(chunk);
      client.pipe(upstream).pipe(client);
    });
    client.once("close", closeBoth);
    upstream.once("close", closeBoth);
  };
  const server = createServer((client) => {
    accepted += 1;
    if (mode === "reject") {
      client.destroy();
      return;
    }
    if (mode === "stall") {
      const chunks: Buffer[] = [];
      const capture = (chunk: Buffer) => chunks.push(Buffer.from(chunk));
      const cleanup = () => {
        pending.delete(client);
        client.destroy();
      };
      pending.set(client, { chunks, capture, cleanup });
      client.on("data", capture);
      client.once("error", cleanup);
      client.once("close", cleanup);
      return;
    }
    attach(client);
  });
  await new Promise<void>((ok, bad) => {
    server.once("error", bad);
    server.listen(0, "127.0.0.1", () => ok());
  });
  return {
    port: (server.address() as AddressInfo).port,
    setStall(value: boolean) {
      mode = value ? "stall" : "forward";
    },
    setRejectNewConnections(value: boolean) {
      mode = value ? "reject" : "forward";
    },
    pendingCount: () =>
      [...pending.keys()].filter((client) => !client.destroyed && !client.readableEnded).length,
    pendingByteCount: () => [...pending.keys()].reduce((sum, socket) => sum + socket.bytesRead, 0),
    acceptedCount: () => accepted,
    release() {
      let count = 0;
      for (const [client, held] of pending) {
        client.pause();
        client.off("data", held.capture);
        client.off("error", held.cleanup);
        client.off("close", held.cleanup);
        pending.delete(client);
        if (client.destroyed || client.readableEnded) {
          client.destroy();
          continue;
        }
        attach(client, held.chunks);
        count += 1;
      }
      return count;
    },
    async close() {
      for (const client of pending.keys()) client.destroy();
      pending.clear();
      for (const socket of live) socket.destroy();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}
