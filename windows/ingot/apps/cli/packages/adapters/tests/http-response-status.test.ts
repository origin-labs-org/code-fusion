import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeHttpClientAdapter } from "../src/http/index.js";
import { createNetworkProxyFetch } from "../src/network/proxy-fetch.js";

//
//

const BODY = "blocked";
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

describe("HttpClientPort through a proxy", () => {
  it("returns a nonstandard status such as 999 as an ordinary response", async () => {
    const proxy = await answeringProxy(999);
    const adapter = createNodeHttpClientAdapter({ env: { CF_HTTP_PROXY: proxy } });

    const response = await adapter.request({ url: "http://profiles.example/in/someone" });

    expect(response.status).toBe(999);
    expect(new TextDecoder().decode(response.body)).toBe(BODY);
  });

  it.each([204, 304])("returns %i with an empty body", async (status) => {
    const proxy = await answeringProxy(status);
    const adapter = createNodeHttpClientAdapter({ env: { CF_HTTP_PROXY: proxy } });

    const response = await adapter.request({ url: "http://profiles.example/in/someone" });

    expect(response.status).toBe(status);
    expect(response.bytes).toBe(0);
  });
});

describe("proxy-aware fetch", () => {
  it.each([204, 304])("resolves %i as a Response with no body", async (status) => {
    const proxyFetch = createNetworkProxyFetch({ httpProxy: await answeringProxy(status) });

    const response = await proxyFetch("http://api.example/v1/ping");

    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
  });

  it("fails only this request when the status cannot be a Response", async () => {
    const proxyFetch = createNetworkProxyFetch({ httpProxy: await answeringProxy(999) });

    await expect(proxyFetch("http://api.example/v1/ping")).rejects.toMatchObject({
      code: "CF_UNSUPPORTED_HTTP_STATUS",
      name: "TypeError",
      status: 999,
    });
    const next = createNetworkProxyFetch({ httpProxy: await answeringProxy(200) });
    expect((await next("http://api.example/v1/ping")).status).toBe(200);
  });
});

async function answeringProxy(status: number): Promise<string> {
  const server = http.createServer((_request, response) => {
    response.writeHead(status, { "content-type": "text/plain" });
    response.end(status === 204 || status === 304 ? undefined : BODY);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
