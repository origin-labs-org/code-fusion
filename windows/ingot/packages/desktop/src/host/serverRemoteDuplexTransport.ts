import { Agent, request } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket } from "ws";

export type ServerRemoteDuplexFactory = () => Duplex | Promise<Duplex>;

interface SocketCompatibleDuplex extends Duplex {
  ref(): this;
  unref(): this;
  setKeepAlive(enable?: boolean, initialDelay?: number): this;
  setNoDelay(noDelay?: boolean): this;
  setTimeout(timeout: number, callback?: () => void): this;
}

function asSocketCompatibleDuplex(stream: Duplex): SocketCompatibleDuplex {
  const socket = stream as SocketCompatibleDuplex;
  socket.ref ??= () => socket;
  socket.unref ??= () => socket;
  socket.setKeepAlive ??= () => socket;
  socket.setNoDelay ??= () => socket;
  socket.setTimeout ??= (_timeout: number, callback?: () => void) => {
    if (callback) socket.once("timeout", callback);
    return socket;
  };
  return socket;
}

export async function createReusableDuplexHttpAgent(
  createConnection: ServerRemoteDuplexFactory,
): Promise<Agent> {
  const stream = asSocketCompatibleDuplex(await createConnection());
  const agent = new Agent({
    keepAlive: true,
    maxFreeSockets: 1,
    maxSockets: 1,
  });
  let connectionCreated = false;
  agent.createConnection = (() => {
    if (connectionCreated) {
      throw new Error("Reusable Duplex HTTP agent attempted to create a second connection");
    }
    connectionCreated = true;
    return stream;
  }) as Agent["createConnection"];
  return agent;
}

export interface DuplexJsonRequestOptions {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  createConnection: ServerRemoteDuplexFactory;
  agent?: Agent;
}

export async function requestJsonOverDuplex<T>(
  options: DuplexJsonRequestOptions,
): Promise<{ status: number; body: T }> {
  const url = new URL(options.url);
  if (url.protocol !== "http:") {
    throw new Error(`Duplex Server requests require http:, received ${url.protocol}`);
  }
  let agent = options.agent;
  if (!agent) {
    const stream = asSocketCompatibleDuplex(await options.createConnection());
    agent = new Agent({ keepAlive: false });
    agent.createConnection = (() => stream) as Agent["createConnection"];
  }
  return await new Promise((resolve, reject) => {
    const clientRequest = request(
      url,
      {
        agent,
        method: options.method ?? "GET",
        headers: {
          connection: options.agent ? "keep-alive" : "close",
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | Uint8Array | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.once("error", reject);
        response.once("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as T,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    clientRequest.once("error", reject);
    if (options.body) clientRequest.write(options.body);
    clientRequest.end();
  });
}

export interface DuplexWebSocketOptions {
  url: string;
  headers?: Record<string, string>;
  createConnection: ServerRemoteDuplexFactory;
  agent?: Agent;
  onSocketCreated?: (socket: WebSocket) => void;
}

export async function connectWebSocketOverDuplex(
  options: DuplexWebSocketOptions,
): Promise<WebSocket> {
  const url = new URL(options.url);
  if (url.protocol !== "ws:") {
    throw new Error(`Duplex Server WebSockets require ws:, received ${url.protocol}`);
  }
  let agent = options.agent;
  if (!agent) {
    const stream = asSocketCompatibleDuplex(await options.createConnection());
    agent = new Agent({ keepAlive: false });
    agent.createConnection = (() => stream) as Agent["createConnection"];
  }
  return await new Promise((resolve, reject) => {
    const webSocket = new WebSocket(url, {
      agent,
      headers: options.headers,
    });
    options.onSocketCreated?.(webSocket);
    let settled = false;
    webSocket.once("open", () => {
      settled = true;
      resolve(webSocket);
    });
    webSocket.once("error", (error) => {
      if (!settled) reject(error);
    });
    webSocket.once("close", (code, reason) => {
      if (!settled) {
        reject(
          new Error(
            reason.length > 0
              ? `WebSocket closed before ready: ${reason.toString("utf8")}`
              : `WebSocket closed before ready (${code})`,
          ),
        );
      }
    });
  });
}
