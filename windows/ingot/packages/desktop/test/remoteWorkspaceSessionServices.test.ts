import { describe, expect, it, vi } from "vitest";
import { IHooksService, type IServiceAccessor } from "@origin-ai/cf-services";
import { ChannelClient, ChannelServer, ProxyChannel, createQueuePair } from "@origin-ai/cf-rpc";
import {
  buildRemoteWorkspaceSessionServices,
  buildRemoteWorkspaceSessionServicesForRegistration,
  buildServerRemoteWorkspaceSessionServices,
} from "../src/renderer/src/remoteWorkspaceSessionServices.js";

function makeServices(id: string): IServiceAccessor {
  return {
    fileService: { id, service: "file" },
    gitService: { id, service: "git" },
    gitCheckpointService: { id, service: "gitCheckpoint" },
    systemService: { id, service: "system" },
    terminalService: { id, service: "terminal" },
    promptAttachmentTransferService: { id, service: "prompt-attachment-transfer" },
    cfAgentService: { id, service: "cf-agent" },
    cfTaskService: { id, service: "cf-task" },
    cfSessionService: { id, service: "cf-session" },
    conversationShareService: { id, service: "conversation-share" },
    fileWatcherService: { id, service: "fileWatcher" },
    skillsService: { id, service: "skills" },
    skillSyncService: { id, service: "skill-sync" },
    mcpSyncService: { id, service: "mcp-sync" },
    pluginSyncService: { id, service: "plugin-sync" },
    pluginsService: { id, service: "plugins" },
    commandsService: { id, service: "commands" },
    hooksService: { id, service: "hooks" },
    clientScenesService: { id, service: "clientScenes" },
    settingService: { id, service: "setting" },
    credentialService: { id, service: "credential" },
    oauthService: { id, service: "oauth" },
    broadcastService: { id, service: "broadcast" },
    modelSelectionService: { id, service: "model-selection" },
    providerSettingsService: { id, service: "provider-settings" },
  } as unknown as IServiceAccessor;
}

describe("buildRemoteWorkspaceSessionServices", () => {
  it("uses remote filesystem/runtime services and keeps local global services", () => {
    const baseServices = makeServices("base");
    const remoteServices = makeServices("remote");

    const merged = buildRemoteWorkspaceSessionServices(baseServices, remoteServices);

    expect(merged.fileService).toBe(remoteServices.fileService);
    expect(merged.gitService).toBe(remoteServices.gitService);
    expect(merged.gitCheckpointService).toBe(remoteServices.gitCheckpointService);
    expect(merged.systemService).toBe(remoteServices.systemService);
    expect(merged.terminalService).toBe(remoteServices.terminalService);
    expect(merged.promptAttachmentTransferService).toBe(
      remoteServices.promptAttachmentTransferService,
    );
    expect(merged.cfAgentService).toBe(remoteServices.cfAgentService);
    expect(merged.cfTaskService).toBe(remoteServices.cfTaskService);
    expect(merged.cfSessionService).toBe(remoteServices.cfSessionService);
    expect(merged.conversationShareService).toBe(remoteServices.conversationShareService);
    expect(merged.fileWatcherService).toBe(remoteServices.fileWatcherService);
    expect(merged.modelSelectionService).toBe(remoteServices.modelSelectionService);
    expect(merged.providerSettingsService).toBe(remoteServices.providerSettingsService);
    expect(merged.skillsService).toBe(remoteServices.skillsService);
    expect(merged.skillSyncService).toBe(remoteServices.skillSyncService);
    expect(merged.mcpSyncService).toBe(remoteServices.mcpSyncService);
    expect(merged.pluginSyncService).toBe(remoteServices.pluginSyncService);
    expect(merged.pluginsService).toBe(remoteServices.pluginsService);
    expect(merged.commandsService).toBe(remoteServices.commandsService);
    expect(merged.hooksService).toBe(remoteServices.hooksService);

    expect(merged.clientScenesService).toBe(baseServices.clientScenesService);
    expect(merged.settingService).toBe(baseServices.settingService);
    expect(merged.credentialService).toBe(baseServices.credentialService);
    expect(merged.oauthService).toBe(baseServices.oauthService);
    expect(merged.broadcastService).toBe(baseServices.broadcastService);
  });

  it("uses server-authoritative services for server remote workspaces", () => {
    const baseServices = makeServices("base");
    const remoteServices = makeServices("remote");

    const merged = buildServerRemoteWorkspaceSessionServices(baseServices, remoteServices);

    expect(merged.fileService).toBe(remoteServices.fileService);
    expect(merged.cfTaskService).toBe(remoteServices.cfTaskService);
    expect(merged.promptAttachmentTransferService).toBe(
      remoteServices.promptAttachmentTransferService,
    );
    expect(merged.settingService).toBe(remoteServices.settingService);
    expect(merged.credentialService).toBe(remoteServices.credentialService);
    expect(merged.oauthService).toBe(remoteServices.oauthService);
    expect(merged.clientScenesService).toBe(remoteServices.clientScenesService);
    expect(merged.broadcastService).toBe(remoteServices.broadcastService);
  });

  it("uses server authority for an identified Source connected through SSH", () => {
    const baseServices = makeServices("base");
    const remoteServices = makeServices("remote");

    const merged = buildRemoteWorkspaceSessionServicesForRegistration({
      baseServices,
      remoteServices,
      targetKind: "ssh",
      sourceServerId: "source-a",
    });

    expect(merged.modelSelectionService).toBe(remoteServices.modelSelectionService);
    expect(merged.providerSettingsService).toBe(remoteServices.providerSettingsService);
    expect(merged.settingService).toBe(remoteServices.settingService);
  });

  it("keeps legacy mixed authority for an unidentified SSH attachment", () => {
    const baseServices = makeServices("base");
    const remoteServices = makeServices("remote");

    const merged = buildRemoteWorkspaceSessionServicesForRegistration({
      baseServices,
      remoteServices,
      targetKind: "ssh",
    });

    expect(merged.settingService).toBe(baseServices.settingService);
    expect(merged.fileService).toBe(remoteServices.fileService);
    expect(merged.modelSelectionService).toBe(remoteServices.modelSelectionService);
  });

  it("routes hook load/save/trust RPC through the remote channel with original workspace params", async () => {
    const remoteLoadHooks = vi.fn(async () => ({ hooks: [], hooksEnabled: false }));
    const remoteSaveHooks = vi.fn(async () => undefined);
    const remoteGrant = vi.fn(async () => ({ accepted: true }));
    const remoteHost = {
      loadHooks: remoteLoadHooks,
      saveHooks: remoteSaveHooks,
      grantWorkspaceHookTrust: remoteGrant,
    } satisfies IHooksService;
    const baseLoadHooks = vi.fn(async () => ({ hooks: [], hooksEnabled: false }));
    const baseSaveHooks = vi.fn(async () => undefined);
    const baseGrant = vi.fn(async () => ({ accepted: false }));

    const [serverProtocol, clientProtocol] = createQueuePair();
    const server = new ChannelServer(serverProtocol, "remote-host-test");
    server.registerChannel(IHooksService.channelName, ProxyChannel.fromService(remoteHost));
    const client = new ChannelClient(clientProtocol);
    const remoteHooksProxy = ProxyChannel.toService<IHooksService>(
      client.getChannel(IHooksService.channelName),
    );

    const baseServices: IServiceAccessor = {
      ...makeServices("base"),
      hooksService: {
        loadHooks: baseLoadHooks,
        saveHooks: baseSaveHooks,
        grantWorkspaceHookTrust: baseGrant,
      } satisfies IHooksService,
    };
    const remoteServices: IServiceAccessor = {
      ...makeServices("remote"),
      hooksService: remoteHooksProxy,
    };
    const merged = buildRemoteWorkspaceSessionServices(baseServices, remoteServices);

    const target = {
      workspacePath: "/data/xuzicang/MultiJoin",
      workspaceIdentity: "remote:ssh:222.29.156.145:22:xuzicang:/data/xuzicang/MultiJoin",
    };

    try {
      await expect(merged.hooksService.loadHooks(target)).resolves.toEqual({
        hooks: [],
        hooksEnabled: false,
      });
      await merged.hooksService.saveHooks({ ...target, hooks: [] });
      await expect(
        merged.hooksService.grantWorkspaceHookTrust?.({
          ...target,
          bundleDigest: "bundle-digest",
          hookDeclarationDigest: "hook-digest",
        }),
      ).resolves.toEqual({ accepted: true });

      expect(remoteLoadHooks).toHaveBeenCalledWith(target);
      expect(remoteSaveHooks).toHaveBeenCalledWith({ ...target, hooks: [] });
      expect(remoteGrant).toHaveBeenCalledWith({
        ...target,
        bundleDigest: "bundle-digest",
        hookDeclarationDigest: "hook-digest",
      });
      expect(baseLoadHooks).not.toHaveBeenCalled();
      expect(baseSaveHooks).not.toHaveBeenCalled();
      expect(baseGrant).not.toHaveBeenCalled();
    } finally {
      client.dispose();
      server.dispose();
    }
  });
});
