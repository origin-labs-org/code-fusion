import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalhostOAuthCallbackServer,
  MCP_OAUTH_CALLBACK_DENIED_ERROR_CODE,
  type LocalhostOAuthCallbackServer,
} from "../src/auth/localhost-callback.js";

const CALLBACK_PATH = "/oauth/callback/mcp/callback-test";
const CORRECT_STATE = "correct-transaction-state";

const openServers: LocalhostOAuthCallbackServer[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

async function createServer(): Promise<LocalhostOAuthCallbackServer> {
  const server = await createLocalhostOAuthCallbackServer({
    callbackPath: CALLBACK_PATH,
    state: CORRECT_STATE,
  });
  openServers.push(server);
  return server;
}

describe("localhost OAuth callback server", () => {
  it("keeps waiting after a mismatched state request and still accepts the correct callback", async () => {
    const server = await createServer();

    const mismatched = await fetch(
      `${server.callbackUrl}?state=some-other-transaction&code=other-code`,
    );
    expect(mismatched.status).toBe(400);

    const accepted = await fetch(`${server.callbackUrl}?state=${CORRECT_STATE}&code=good-code`);
    expect(accepted.status).toBe(200);

    const callback = await server.waitForCallback();
    expect(callback.code).toBe("good-code");
  });

  it("does not settle on requests for another path", async () => {
    const server = await createServer();

    const wrongPath = await fetch(`${server.callbackUrl}-other?state=${CORRECT_STATE}&code=x`);
    expect(wrongPath.status).toBe(404);

    const pending = await Promise.race([
      server.waitForCallback().then(() => "settled" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);
    expect(pending).toBe("pending");
  });

  it("fails immediately when the authorization server reports access_denied", async () => {
    const server = await createServer();
    const captured = server.waitForCallback().catch((error: unknown) => error);

    const denied = await fetch(
      `${server.callbackUrl}?state=${CORRECT_STATE}&error=access_denied&error_description=User%20denied%20the%20request`,
    );
    expect(denied.status).toBe(400);

    await expect(captured).resolves.toMatchObject({
      code: MCP_OAUTH_CALLBACK_DENIED_ERROR_CODE,
      oauthError: "access_denied",
      oauthErrorDescription: "User denied the request",
    });
  });

  it("fails immediately when the matching-state callback carries neither code nor error", async () => {
    const server = await createServer();
    const captured = server.waitForCallback().catch((error: unknown) => error);

    const malformed = await fetch(`${server.callbackUrl}?state=${CORRECT_STATE}`);
    expect(malformed.status).toBe(400);

    await expect(captured).resolves.toMatchObject({
      message: expect.stringContaining("missing an authorization code"),
    });
  });
});
