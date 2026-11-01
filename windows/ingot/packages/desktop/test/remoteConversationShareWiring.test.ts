import { describe, expect, it, vi } from "vitest";
import { IConversationShareService, type IServiceAccessor } from "@origin-ai/cf-services";
import { createServerRemoteWorkspaceServiceCollection } from "@desktop/host/remoteWorkspaceServiceCollection.js";
import { REMOTE_WORKSPACE_RPC_CHANNELS } from "@desktop/host/remoteWorkspaceRpcContract.js";
import { scopeConversationShareServiceForAttachment } from "@desktop/host/conversationShareAttachmentService.js";

const input = {
  workspacePath: "/remote/project",
  workspaceIdentity: "remote:server:device:/remote/project",
  remoteSessionId: "remote-session",
  sessionId: "session",
  selection: { kind: "productTurns" as const, productTurnIds: ["turn"] },
};
function fixture() {
  const preflight = vi.fn(async () => ({ remote: true }));
  const credential = {
    load: vi.fn(() => {
      throw new Error("Desktop 不得读凭据替远端发布");
    }),
  };
  const connectionServices = {
    ...Object.fromEntries(REMOTE_WORKSPACE_RPC_CHANNELS.map((key) => [key, {}])),
    credentialService: credential,
    conversationShareService: { preflight, publish: vi.fn(), getCapabilities: vi.fn() },
  } as unknown as IServiceAccessor;
  const clientConfigService = { getSnapshot: vi.fn(async () => ({ pluginStoreOrder: null })) };
  return { clientConfigService, connectionServices, preflight, credential };
}

describe("R3 remote sharing assembly", () => {
  it.each(["ssh", "wsl", "docker"] as const)(
    "%s directly uses the Source sharing service without reading Desktop or remote Secret",
    async (targetKind) => {
      const f = fixture();
      const service = createServerRemoteWorkspaceServiceCollection({ ...f, targetKind }).get(
        IConversationShareService,
      );
      await expect(service.preflight(input)).resolves.toEqual({ remote: true });
      expect(f.preflight).toHaveBeenCalledWith(input);
      expect(f.credential.load).not.toHaveBeenCalled();
    },
  );
  it("Sharing remains prohibited for direct server connections", async () => {
    const f = fixture();
    const service = createServerRemoteWorkspaceServiceCollection({
      ...f,
      targetKind: "server",
    }).get(IConversationShareService);
    await expect(service.preflight(input)).rejects.toMatchObject({ kind: "feature_disabled" });
    expect(f.preflight).not.toHaveBeenCalled();
  });
  it("Mobile devices cannot publish even when attached to an available Source", async () => {
    const f = fixture();
    const raw = createServerRemoteWorkspaceServiceCollection({ ...f, targetKind: "ssh" }).get(
      IConversationShareService,
    );
    const service = scopeConversationShareServiceForAttachment(raw, "web-remote-replayable");
    await expect(service.preflight(input)).rejects.toMatchObject({ kind: "feature_disabled" });
    await expect(service.publish({} as never, "op")).rejects.toMatchObject({
      kind: "feature_disabled",
    });
    expect(f.preflight).not.toHaveBeenCalled();
  });
  it("Reassembly uses the new connection and cannot retain the old Source service", async () => {
    const old = fixture();
    const next = fixture();
    createServerRemoteWorkspaceServiceCollection({ ...old, targetKind: "ssh" });
    const current = createServerRemoteWorkspaceServiceCollection({
      ...next,
      targetKind: "ssh",
    }).get(IConversationShareService);
    await current.preflight(input);
    expect(next.preflight).toHaveBeenCalledOnce();
    expect(old.preflight).not.toHaveBeenCalled();
  });
});
