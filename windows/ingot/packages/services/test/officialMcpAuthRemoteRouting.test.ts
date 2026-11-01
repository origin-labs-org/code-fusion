
import { describe, expect, it, vi } from "vitest";
import { cfProtocolMethods } from "@origin-ai/cf-shared";

const LOCAL_WORKSPACE = {
  workspaceKey: "/workspace/app",
  workspacePath: "/workspace/app",
};
const REMOTE_WORKSPACE = {
  workspaceIdentity: "remote:wsl:ubuntu:/workspace/app",
  workspaceKey: "remote:wsl:ubuntu:/workspace/app",
  workspacePath: "/workspace/app",
};

interface FakeClient {
  onRequestListener?: (request: unknown) => void;
  respond: ReturnType<typeof vi.fn>;
  respondError: ReturnType<typeof vi.fn>;
}

async function createServiceWithClients(options: {
  officialMcpAuthHeadersResolver?: {
    resolveHeaders(
      request?: unknown,
    ): Promise<
      | { ok: true; headers: Record<string, string> }
      | { ok: false; reason: "official_auth_unavailable" | "official_auth_plan_required" }
    >;
  };
  
  officialMcpTrustedOrigins?: {
    isTrusted(input: { pluginId: string; mcpKey: string; origin: string }): Promise<{
      detail?: string;
      trusted: boolean;
    }>;
  };
  
  omitTrustedOrigins?: boolean;
}): Promise<{
  clients: Map<string, FakeClient>;
  dispose: () => Promise<void>;
  initializeWorkspace: (workspace: {
    workspaceIdentity?: string;
    workspacePath: string;
  }) => Promise<void>;
}> {
  const clients = new Map<string, FakeClient>();

  vi.resetModules();
  vi.doMock("../src/cf-agent/cfAgentProcessManager.js", () => ({
    CfAgentProcessManager: class {
      onRuntimeRestarted() {
        return { dispose() {} };
      }
      async getClient(params: { workspaceIdentity?: string; workspacePath: string }) {
        const key = params.workspaceIdentity ?? params.workspacePath;
        const existing = clients.get(key);
        if (existing) return toProtocolClient(existing);
        const record: FakeClient = {
          respond: vi.fn(async () => {}),
          respondError: vi.fn(async () => {}),
        };
        clients.set(key, record);
        return toProtocolClient(record);
      }
      getExistingClient(params: { workspaceIdentity?: string; workspacePath: string }) {
        const record = clients.get(params.workspaceIdentity ?? params.workspacePath);
        return record ? toProtocolClient(record) : undefined;
      }
      getRuntimeIdentity() {
        return undefined;
      }
      markReady() {}
      onRuntimeLifecycle() {
        return { dispose() {} };
      }
      disposeWorkspace() {}
      disposeAll() {}
      async disposeAllAndWait() {}
    },
  }));

  function toProtocolClient(record: FakeClient) {
    return {
      onClose: () => ({ dispose() {} }),
      onNotification: () => ({ dispose() {} }),
      onRequest: (listener: (request: unknown) => void) => {
        record.onRequestListener = listener;
        return { dispose() {} };
      },
      request: async (method: string) => {
        if (method === cfProtocolMethods.initialize) {
          return {
            available: true,
            protocolName: "CodeFusion Protocol",
            protocolVersion: 1,
            workspaceKey: "/workspace/app",
          };
        }
        throw new Error(`Unexpected request method: ${method}`);
      },
      respond: record.respond,
      respondError: record.respondError,
      transportKind: "stdio",
    };
  }

  const { createCfAgentService } = await import("../src/cf-agent/cfAgentService.js");
  const service = createCfAgentService({
    modelSelectionReadinessSource: {
      async getView() {
        return {
          providers: [
            {
              providerId: "account:zai-start-plan",
              config: {
                kind: "account" as const,
                api: {
                  type: "anthropic-messages" as const,
                  baseUrl: "https://cf.z.ai/api/v1/cf-plan",
                },
                models: ["GLM-5.2"],
              },
              models: [{ modelId: "GLM-5.2", config: {} }],
            },
          ],
          revision: 1,
        };
      },
    },
    ...(options.officialMcpAuthHeadersResolver
      ? { officialMcpAuthHeadersResolver: options.officialMcpAuthHeadersResolver }
      : {}),
    ...(options.omitTrustedOrigins
      ? {}
      : {
          officialMcpTrustedOrigins: options.officialMcpTrustedOrigins ?? {
            isTrusted: async () => ({ trusted: true }),
          },
        }),
  });

  return {
    clients,
    dispose: () => service.disposeAllAndWait(),
    initializeWorkspace: async (workspace) => {
      const result = await service.initialize(workspace);
      if (!result.available) {
        throw new Error(`agent initialize failed: ${result.reason ?? "unknown"}`);
      }
    },
  };
}

function officialMcpAuthRequest(
  id: string,
  workspace: Record<string, string>,
): Record<string, unknown> {
  return {
    id,
    method: cfProtocolMethods.interactionRequestOfficialMcpAuthHeaders,
    params: {
      mcpKey: "image-search",
      pluginId: "cf-tools@cf-plugins-official",
      requestId: `official-mcp-auth:${id}`,
      targetOrigin: "https://mcp.cf.example",
      workspace,
    },
  };
}

describe("official mcp auth headers over desktop-attached remote", () => {
  it("OMCP-011: answers a remote agent on its own client, not the same-path local one", async () => {
    const headers = {
      Authorization: "Bearer remote-jwt",
      "Bigmodel-Target-Type": "PERSONAL",
      "X-Bigmodel-Authorization": "Bearer remote-maas-jwt",
    };
    const harness = await createServiceWithClients({
      officialMcpAuthHeadersResolver: {
        resolveHeaders: async () => ({ headers, ok: true }),
      },
    });

    try {
      await harness.initializeWorkspace(LOCAL_WORKSPACE);
      await harness.initializeWorkspace(REMOTE_WORKSPACE);
      expect(harness.clients.size).toBe(2);

      const remote = harness.clients.get(REMOTE_WORKSPACE.workspaceIdentity);
      const local = harness.clients.get(LOCAL_WORKSPACE.workspacePath);
      expect(remote).toBeDefined();
      expect(local).toBeDefined();

      remote?.onRequestListener?.(officialMcpAuthRequest("remote-1", REMOTE_WORKSPACE));

      await vi.waitFor(() => {
        expect(remote?.respond).toHaveBeenCalledTimes(1);
      });
      expect(remote?.respond).toHaveBeenCalledWith("remote-1", { headers, ok: true });
      expect(local?.respond).not.toHaveBeenCalled();
    } finally {
      await harness.dispose();
    }
  });

  it("keeps local and remote responses on separate channels under interleaved requests", async () => {
    const harness = await createServiceWithClients({
      officialMcpAuthHeadersResolver: {
        resolveHeaders: async () => ({
          headers: { Authorization: "Bearer shared-jwt" },
          ok: true,
        }),
      },
    });

    try {
      await harness.initializeWorkspace(LOCAL_WORKSPACE);
      await harness.initializeWorkspace(REMOTE_WORKSPACE);
      const remote = harness.clients.get(REMOTE_WORKSPACE.workspaceIdentity);
      const local = harness.clients.get(LOCAL_WORKSPACE.workspacePath);

      local?.onRequestListener?.(officialMcpAuthRequest("local-1", LOCAL_WORKSPACE));
      remote?.onRequestListener?.(officialMcpAuthRequest("remote-1", REMOTE_WORKSPACE));
      local?.onRequestListener?.(officialMcpAuthRequest("local-2", LOCAL_WORKSPACE));

      await vi.waitFor(() => {
        expect(local?.respond).toHaveBeenCalledTimes(2);
        expect(remote?.respond).toHaveBeenCalledTimes(1);
      });
      expect(local?.respond.mock.calls.map((call) => call[0])).toEqual(["local-1", "local-2"]);
      expect(remote?.respond.mock.calls.map((call) => call[0])).toEqual(["remote-1"]);
    } finally {
      await harness.dispose();
    }
  });

  it("propagates a plan-required refusal to the remote agent unchanged", async () => {
    const harness = await createServiceWithClients({
      officialMcpAuthHeadersResolver: {
        resolveHeaders: async () => ({ ok: false, reason: "official_auth_plan_required" }),
      },
    });

    try {
      await harness.initializeWorkspace(REMOTE_WORKSPACE);
      const remote = harness.clients.get(REMOTE_WORKSPACE.workspaceIdentity);
      remote?.onRequestListener?.(officialMcpAuthRequest("remote-1", REMOTE_WORKSPACE));

      await vi.waitFor(() => {
        expect(remote?.respond).toHaveBeenCalledTimes(1);
      });
      expect(remote?.respond).toHaveBeenCalledWith("remote-1", {
        ok: false,
        reason: "official_auth_plan_required",
      });
    } finally {
      await harness.dispose();
    }
  });

  it("OMCP-009: reports official_auth_unavailable when no resolver is wired", async () => {
    const harness = await createServiceWithClients({});
    try {
      await harness.initializeWorkspace(REMOTE_WORKSPACE);
      const remote = harness.clients.get(REMOTE_WORKSPACE.workspaceIdentity);
      remote?.onRequestListener?.(officialMcpAuthRequest("remote-1", REMOTE_WORKSPACE));

      await vi.waitFor(() => {
        expect(remote?.respond).toHaveBeenCalledTimes(1);
      });
      expect(remote?.respond).toHaveBeenCalledWith("remote-1", {
        ok: false,
        reason: "official_auth_unavailable",
      });
    } finally {
      await harness.dispose();
    }
  });

  it("CR-01: rejects an untrusted origin without invoking the resolver at all", async () => {
    const resolveHeaders = vi.fn(async () => ({
      headers: { Authorization: "Bearer must-not-leak" },
      ok: true as const,
    }));
    const harness = await createServiceWithClients({
      officialMcpAuthHeadersResolver: { resolveHeaders },
      officialMcpTrustedOrigins: { isTrusted: async () => ({ trusted: false }) },
    });

    try {
      await harness.initializeWorkspace(REMOTE_WORKSPACE);
      const remote = harness.clients.get(REMOTE_WORKSPACE.workspaceIdentity);
      remote?.onRequestListener?.(officialMcpAuthRequest("remote-1", REMOTE_WORKSPACE));

      await vi.waitFor(() => {
        expect(remote?.respond).toHaveBeenCalledTimes(1);
      });
      expect(resolveHeaders).not.toHaveBeenCalled();
      expect(remote?.respond).toHaveBeenCalledWith("remote-1", {
        ok: false,
        reason: "official_mcp_origin_untrusted",
      });
      const payload = remote?.respond.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(JSON.stringify(payload)).not.toContain("must-not-leak");
    } finally {
      await harness.dispose();
    }
  });

  it("CR-01: fails closed when no trusted-origin validator is injected", async () => {
    const resolveHeaders = vi.fn(async () => ({
      headers: { Authorization: "Bearer must-not-leak" },
      ok: true as const,
    }));
    const harness = await createServiceWithClients({
      officialMcpAuthHeadersResolver: { resolveHeaders },
      omitTrustedOrigins: true,
    });
    try {
      await harness.initializeWorkspace(REMOTE_WORKSPACE);
      const remote = harness.clients.get(REMOTE_WORKSPACE.workspaceIdentity);
      remote?.onRequestListener?.(officialMcpAuthRequest("remote-1", REMOTE_WORKSPACE));
      await vi.waitFor(() => {
        expect(remote?.respond).toHaveBeenCalledTimes(1);
      });
      expect(resolveHeaders).not.toHaveBeenCalled();
    } finally {
      await harness.dispose();
    }
  });

  it("CR-01: validates all three dimensions, not just one", async () => {
    const seen: Array<{ mcpKey: string; origin: string; pluginId: string }> = [];
    const harness = await createServiceWithClients({
      officialMcpAuthHeadersResolver: {
        resolveHeaders: async () => ({ headers: { Authorization: "Bearer ok" }, ok: true }),
      },
      officialMcpTrustedOrigins: {
        isTrusted: async (input) => {
          seen.push(input);
          return {
            trusted:
              input.pluginId === "cf-tools@cf-plugins-official" &&
              input.mcpKey === "image-search" &&
              input.origin === "https://mcp.cf.example",
          };
        },
      },
    });

    try {
      await harness.initializeWorkspace(REMOTE_WORKSPACE);
      const remote = harness.clients.get(REMOTE_WORKSPACE.workspaceIdentity);
      const variants: Array<{ id: string; overrides: Record<string, string> }> = [
        { id: "bad-plugin", overrides: { pluginId: "evil@third-party" } },
        { id: "bad-key", overrides: { mcpKey: "unregistered" } },
        { id: "bad-origin", overrides: { targetOrigin: "https://attacker.example" } },
      ];
      for (const variant of variants) {
        const base = officialMcpAuthRequest(variant.id, REMOTE_WORKSPACE);
        const params = base["params"] as Record<string, unknown>;
        remote?.onRequestListener?.({
          ...base,
          params: { ...params, ...variant.overrides },
        });
      }
      await vi.waitFor(() => {
        expect(remote?.respond).toHaveBeenCalledTimes(3);
      });
      for (const call of remote?.respond.mock.calls ?? []) {
        expect(call[1]).toEqual({ ok: false, reason: "official_mcp_origin_untrusted" });
      }
      expect(seen).toHaveLength(3);
      expect(seen.every((input) => input.pluginId && input.mcpKey && input.origin)).toBe(true);
    } finally {
      await harness.dispose();
    }
  });

  it("CR-01: forwards the request context to the resolver once trusted", async () => {
    const resolveHeaders = vi.fn(async () => ({
      headers: { Authorization: "Bearer ok" },
      ok: true as const,
    }));
    const harness = await createServiceWithClients({
      officialMcpAuthHeadersResolver: { resolveHeaders },
    });
    try {
      await harness.initializeWorkspace(REMOTE_WORKSPACE);
      const remote = harness.clients.get(REMOTE_WORKSPACE.workspaceIdentity);
      remote?.onRequestListener?.(officialMcpAuthRequest("remote-1", REMOTE_WORKSPACE));
      await vi.waitFor(() => {
        expect(resolveHeaders).toHaveBeenCalledTimes(1);
      });
      expect(resolveHeaders).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpKey: "image-search",
          pluginId: "cf-tools@cf-plugins-official",
          targetOrigin: "https://mcp.cf.example",
          workspace: expect.objectContaining({
            workspaceIdentity: REMOTE_WORKSPACE.workspaceIdentity,
          }),
        }),
      );
    } finally {
      await harness.dispose();
    }
  });

  it("rejects malformed params without invoking the resolver", async () => {
    const resolveHeaders = vi.fn(async () => ({
      headers: { Authorization: "Bearer jwt" },
      ok: true as const,
    }));
    const harness = await createServiceWithClients({
      officialMcpAuthHeadersResolver: { resolveHeaders },
    });

    try {
      await harness.initializeWorkspace(REMOTE_WORKSPACE);
      const remote = harness.clients.get(REMOTE_WORKSPACE.workspaceIdentity);
      remote?.onRequestListener?.({
        id: "remote-bad",
        method: cfProtocolMethods.interactionRequestOfficialMcpAuthHeaders,
        params: {
          jwt: "leaked",
          mcpKey: "image-search",
          pluginId: "cf-tools@cf-plugins-official",
          requestId: "official-mcp-auth:bad",
          workspace: REMOTE_WORKSPACE,
        },
      });

      await vi.waitFor(() => {
        expect(remote?.respondError).toHaveBeenCalledTimes(1);
      });
      expect(resolveHeaders).not.toHaveBeenCalled();
      expect(remote?.respond).not.toHaveBeenCalled();
      expect(remote?.respondError).toHaveBeenCalledWith(
        "remote-bad",
        expect.objectContaining({ code: -32602 }),
      );
    } finally {
      await harness.dispose();
    }
  });
});
