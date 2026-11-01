
import { describe, expect, it, vi } from "vitest";
import { cfProtocolMethods } from "@origin-ai/cf-shared";
import {
  createOfficialMcpAuthHeadersPort,
  type OfficialMcpAuthRequestContext,
} from "../src/cf-protocol/official-mcp-auth-port.js";

const OK = { headers: { Authorization: "Bearer jwt" }, ok: true as const };

function entrypointResolveWorkspace(fallbackCwd: string) {
  return ({
    workspaceIdentity,
    workspacePath,
  }: {
    workspaceIdentity?: string;
    workspacePath?: string;
  }) => {
    const path = workspacePath ?? fallbackCwd;
    if (!path) return undefined;
    const identity = workspaceIdentity?.trim();
    return {
      ...(identity ? { workspaceIdentity: identity } : {}),
      workspaceKey: identity || path,
      workspacePath: path,
    };
  };
}

function createHarness(
  options: { resolveWorkspace?: ReturnType<typeof entrypointResolveWorkspace> } = {},
) {
  const requestClient = vi.fn(async () => OK);
  const context = { requestClient } as unknown as OfficialMcpAuthRequestContext;
  const port = createOfficialMcpAuthHeadersPort({
    resolveContext: () => context,
    resolveWorkspace: options.resolveWorkspace ?? entrypointResolveWorkspace("/fallback"),
  });
  const sentWorkspace = (call: number) =>
    (requestClient.mock.calls[call]?.[1] as { workspace: Record<string, string> }).workspace;
  return { port, requestClient, sentWorkspace };
}

const BASE_REQUEST = {
  mcpKey: "image-search",
  pluginId: "cf-tools@cf-plugins-official",
  targetOrigin: "https://mcp.cf.example",
};

describe("official mcp auth headers port", () => {
  it("CR-01: keeps same-path workspaces distinguishable by workspaceIdentity", async () => {
    const { port, sentWorkspace } = createHarness();

    await port.resolveHeaders({
      ...BASE_REQUEST,
      workspaceIdentity: "remote:wsl:ubuntu:/workspace/app",
      workspacePath: "/workspace/app",
    });
    await port.resolveHeaders({ ...BASE_REQUEST, workspacePath: "/workspace/app" });

    expect(sentWorkspace(0)).toEqual({
      workspaceIdentity: "remote:wsl:ubuntu:/workspace/app",
      workspaceKey: "remote:wsl:ubuntu:/workspace/app",
      workspacePath: "/workspace/app",
    });
    expect(sentWorkspace(1)).toEqual({
      workspaceKey: "/workspace/app",
      workspacePath: "/workspace/app",
    });
  });

  it("sends the declared plugin identity and target origin unchanged", async () => {
    const { port, requestClient } = createHarness();
    await port.resolveHeaders({ ...BASE_REQUEST, workspacePath: "/repo" });
    expect(requestClient).toHaveBeenCalledWith(
      cfProtocolMethods.interactionRequestOfficialMcpAuthHeaders,
      expect.objectContaining({
        mcpKey: "image-search",
        pluginId: "cf-tools@cf-plugins-official",
        targetOrigin: "https://mcp.cf.example",
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("uses a distinct requestId per call", async () => {
    const { port, requestClient } = createHarness();
    await port.resolveHeaders({ ...BASE_REQUEST, workspacePath: "/repo" });
    await port.resolveHeaders({ ...BASE_REQUEST, workspacePath: "/repo" });
    const ids = requestClient.mock.calls.map(
      (call) => (call[1] as { requestId: string }).requestId,
    );
    expect(new Set(ids).size).toBe(2);
  });

  it("fails closed when the server context is not ready yet", async () => {
    const requestClient = vi.fn(async () => OK);
    const port = createOfficialMcpAuthHeadersPort({
      resolveContext: () => undefined,
      resolveWorkspace: entrypointResolveWorkspace("/fallback"),
    });
    await expect(port.resolveHeaders({ ...BASE_REQUEST, workspacePath: "/repo" })).resolves.toEqual(
      { ok: false, reason: "official_auth_unavailable" },
    );
    expect(requestClient).not.toHaveBeenCalled();
  });

  it("fails closed when no workspace can be resolved", async () => {
    const { port, requestClient } = createHarness({
      resolveWorkspace: entrypointResolveWorkspace(""),
    });
    await expect(port.resolveHeaders({ ...BASE_REQUEST })).resolves.toEqual({
      ok: false,
      reason: "official_auth_unavailable",
    });
    expect(requestClient).not.toHaveBeenCalled();
  });

  it("maps a transport failure to official_auth_unavailable without leaking details", async () => {
    const context = {
      requestClient: vi.fn(async () => {
        throw new Error("stdio closed: /secret/path context");
      }),
    } as unknown as OfficialMcpAuthRequestContext;
    const port = createOfficialMcpAuthHeadersPort({
      resolveContext: () => context,
      resolveWorkspace: entrypointResolveWorkspace("/fallback"),
    });
    const result = await port.resolveHeaders({ ...BASE_REQUEST, workspacePath: "/repo" });
    expect(result).toEqual({ ok: false, reason: "official_auth_unavailable" });
  });
});
