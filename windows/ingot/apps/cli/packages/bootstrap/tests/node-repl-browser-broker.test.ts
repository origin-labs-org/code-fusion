import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import type { BrowserControlPort, Logger, McpServerConfig } from "@origin-ai/cf-contracts";
import {
  NODE_REPL_BROWSER_BROKER_SOCKET_ENV,
  NODE_REPL_BROWSER_BROKER_TOKEN_ENV,
  nodeReplBrowserBrokerResponseSchema,
} from "@origin-ai/cf-shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNodeReplBrowserBroker,
  injectNodeReplBrowserBroker,
  type NodeReplBrowserBroker,
} from "../src/app/node-repl-browser-broker.js";

const logger: Logger = {
  child: () => logger,
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

describe("node_repl browser broker", () => {
  let broker: NodeReplBrowserBroker | undefined;

  afterEach(async () => {
    await broker?.close();
    broker = undefined;
  });

  it("injects an authenticated local endpoint only into the global node_repl server", async () => {
    broker = createNodeReplBrowserBroker({
      browserControlPort: createBrowserControlPort(),
      logger,
    });
    await broker.ready;
    const untouched: McpServerConfig = { type: "http", url: "https://example.test/mcp" };
    const servers = injectNodeReplBrowserBroker(
      {
        node_repl: { type: "stdio", command: "node", args: ["server.js"] },
        remote: untouched,
      },
      broker,
    );

    expect(servers.node_repl).toMatchObject({
      env: {
        [NODE_REPL_BROWSER_BROKER_SOCKET_ENV]: broker.socketPath,
        [NODE_REPL_BROWSER_BROKER_TOKEN_ENV]: broker.token,
      },
    });
    expect(servers.remote).toBe(untouched);
  });

  it("shares one broker across sessions and forwards the exact session, turn, trace, and browser identity", async () => {
    const browserControlPort = createBrowserControlPort();
    broker = createNodeReplBrowserBroker({ browserControlPort, logger });
    await broker.ready;

    const listResponse = await exchange(broker.socketPath, {
      id: randomUUID(),
      op: "list",
      runtimeScope: "main",
      sessionId: "session-1",
      token: broker.token,
      trace: { traceId: "trace-1", spanId: "span-1" },
      turnId: "turn-1",
    });
    expect(listResponse).toMatchObject({
      ok: true,
      browsers: [{ id: "iab-1", generation: 7 }],
    });
    expect(browserControlPort.list).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        turnId: "turn-1",
        traceContext: { traceId: "trace-1", spanId: "span-1" },
      }),
    );

    const executeResponse = await exchange(broker.socketPath, {
      browserGeneration: 7,
      browserId: "iab-1",
      command: { method: "getState" },
      id: randomUUID(),
      op: "execute",
      runtimeScope: "main",
      sessionId: "session-2",
      token: broker.token,
      turnId: "turn-2",
    });
    expect(executeResponse).toMatchObject({ ok: true, result: { ok: true, value: "ready" } });
    expect(browserControlPort.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        browserGeneration: 7,
        browserId: "iab-1",
        command: { method: "getState" },
        sessionId: "session-2",
        turnId: "turn-2",
      }),
    );
  });

  it("rejects an invalid token before reaching BrowserControlPort", async () => {
    const browserControlPort = createBrowserControlPort();
    broker = createNodeReplBrowserBroker({ browserControlPort, logger });
    await broker.ready;

    const unauthorized = await exchange(broker.socketPath, {
      id: randomUUID(),
      op: "list",
      runtimeScope: "main",
      sessionId: "session-1",
      token: "0".repeat(64),
    });
    expect(unauthorized).toMatchObject({ ok: false });
    expect(browserControlPort.list).not.toHaveBeenCalled();
  });

  it("forwards subagent Browser Use to BrowserControlPort with the child sessionId", async () => {
    const browserControlPort = createBrowserControlPort();
    broker = createNodeReplBrowserBroker({ browserControlPort, logger });
    await broker.ready;

    const subagent = await exchange(broker.socketPath, {
      id: randomUUID(),
      op: "list",
      runtimeScope: "subagent",
      sessionId: "child-session",
      token: broker.token,
    });
    expect(subagent).toMatchObject({ ok: true });
    expect(browserControlPort.list).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "child-session" }),
    );
  });

  it("preserves the client request id when strict command validation fails", async () => {
    broker = createNodeReplBrowserBroker({
      browserControlPort: createBrowserControlPort(),
      logger,
    });
    await broker.ready;
    const requestId = randomUUID();

    const response = await exchange(broker.socketPath, {
      browserGeneration: 7,
      browserId: "iab-1",
      command: {
        action: {
          name: "locator",
          operation: "click",
          selector: "button",
          timeout: 10_000,
        },
        method: "playwright",
      },
      id: requestId,
      op: "execute",
      runtimeScope: "main",
      sessionId: "session-parse-error",
      token: broker.token,
    });

    expect(response).toMatchObject({ id: requestId, ok: false });
    expect(response.ok === false ? response.error : "").toContain("timeout");
  });

  it("stays alive and keeps serving when the client drops the socket while a large response is written", async () => {
    const debugEvents: string[] = [];
    const spyLogger = createSpyLogger(debugEvents);
    const executing = createDeferred<void>();
    const finishExecute = createDeferred<string>();
    const browserControlPort: BrowserControlPort = {
      list: vi.fn(async () => []),
      execute: vi.fn(async () => {
        executing.resolve();
        return { elapsedMs: 1, ok: true as const, value: await finishExecute.promise };
      }),
    };
    broker = createNodeReplBrowserBroker({ browserControlPort, logger: spyLogger });
    await broker.ready;

    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", onUncaught);
    try {
      const socket = createConnection(broker.socketPath);
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.write(
        `${JSON.stringify({
          browserGeneration: 1,
          browserId: "iab-1",
          command: { method: "screenshot" },
          id: randomUUID(),
          op: "execute",
          runtimeScope: "main",
          sessionId: "session-1",
          token: broker.token,
          turnId: "turn-1",
        })}\n`,
      );

      await executing.promise;
      socket.destroy();
      finishExecute.resolve("A".repeat(4 * 1024 * 1024));
      await new Promise<void>((resolve) => setTimeout(resolve, 150));

      expect(uncaught).toEqual([]);
      expect(debugEvents).toContain("node_repl.browser_broker.connection.dropped");
    } finally {
      process.off("uncaughtException", onUncaught);
    }

    const next = await exchange(broker.socketPath, {
      id: randomUUID(),
      op: "list",
      runtimeScope: "main",
      sessionId: "session-2",
      token: broker.token,
    });
    expect(next).toMatchObject({ ok: true });
  });

  it("propagates the client disconnect as an abort into the in-flight BrowserControlPort request", async () => {
    const executing = createDeferred<void>();
    const finishExecute = createDeferred<string>();
    const aborted = createDeferred<void>();
    let executeSignal: AbortSignal | undefined;
    const browserControlPort: BrowserControlPort = {
      list: vi.fn(async () => []),
      execute: vi.fn(async (input) => {
        executeSignal = input.signal;
        input.signal?.addEventListener("abort", () => aborted.resolve(), { once: true });
        executing.resolve();
        return { elapsedMs: 1, ok: true as const, value: await finishExecute.promise };
      }),
    };
    broker = createNodeReplBrowserBroker({ browserControlPort, logger });
    await broker.ready;

    const socket = createConnection(broker.socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write(
      `${JSON.stringify({
        browserGeneration: 1,
        browserId: "iab-1",
        command: { method: "screenshot" },
        id: randomUUID(),
        op: "execute",
        runtimeScope: "main",
        sessionId: "session-1",
        token: broker.token,
        turnId: "turn-1",
      })}\n`,
    );

    await executing.promise;
    socket.destroy();
    await aborted.promise;
    expect(executeSignal?.aborted).toBe(true);

    finishExecute.resolve("A".repeat(64 * 1024));
  });
});

function createSpyLogger(debugEvents: string[]): Logger {
  return {
    ...logger,
    debug: (_message, fields) => {
      const event = (fields as { event?: string } | undefined)?.event;
      if (event) debugEvents.push(event);
    },
  };
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createBrowserControlPort(): BrowserControlPort {
  return {
    list: vi.fn(async () => [
      {
        capabilities: { browser: [], tab: [] },
        generation: 7,
        id: "iab-1",
        name: "CodeFusion Browser",
        type: "iab" as const,
      },
    ]),
    execute: vi.fn(async () => ({ elapsedMs: 1, ok: true, value: "ready" })),
  };
}

async function exchange(socketPath: string, request: unknown) {
  return await new Promise<ReturnType<typeof nodeReplBrowserBrokerResponseSchema.parse>>(
    (resolve, reject) => {
      const socket = createConnection(socketPath);
      let buffer = "";
      socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        try {
          resolve(nodeReplBrowserBrokerResponseSchema.parse(JSON.parse(buffer.slice(0, newline))));
        } catch (error) {
          reject(error);
        } finally {
          socket.destroy();
        }
      });
      socket.once("error", reject);
    },
  );
}
