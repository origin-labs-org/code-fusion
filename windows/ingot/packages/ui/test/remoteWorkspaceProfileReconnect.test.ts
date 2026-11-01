import { describe, expect, it, vi } from "vitest";
import {
  appSettingsSchema,
  type RemoteWorkspaceSessionEntry,
  type SSHProfileTarget,
} from "@origin-ai/cf-shared";
import { reconnectRemoteWorkspaceHistoryEntry } from "@/root/reconnectRemoteWorkspaceHistoryEntry.js";

vi.mock("@/store/remotePinnedTaskStore.js", () => ({
  refreshRemotePinnedTasksForSession: vi.fn(async () => undefined),
}));
vi.mock("@/store/remoteTimelineTaskStore.js", () => ({
  refreshRemoteTimelineTasksForSession: vi.fn(async () => undefined),
}));

const profileId = "17ef20b3-622d-4a53-98c1-0cdff29f3e6d";
const sourceServerId = "3cd4f9da-cd79-426c-9d70-75f36e9f6a87";
const oldTarget: SSHProfileTarget = {
  kind: "ssh",
  host: "old.example.com",
  port: 22,
  username: "old-user",
  passwordCredentialKey: "legacy-password",
};
const updatedTarget: SSHProfileTarget = {
  kind: "ssh",
  host: "new.example.com",
  port: 2222,
  username: "dev",
  passwordCredentialKey: "profile-password",
};

function setup(target: SSHProfileTarget = updatedTarget) {
  const sessionEntry: RemoteWorkspaceSessionEntry = {
    kind: "remote",
    workspacePath: "/workspace/project",
    workspaceIdentity: `remote:server:${sourceServerId}:/workspace/project`,
    target: { ...oldTarget },
    lastOpenedAt: 1,
  };
  const settings = appSettingsSchema.parse({
    connectionProfiles: [{ profileId, sourceServerId, transport: "ssh", target, createdAt: 1 }],
    sourceServerWorkspaceHistory: [
      {
        profileId,
        sourceServerId,
        workspacePath: sessionEntry.workspacePath,
        workspaceIdentity: sessionEntry.workspaceIdentity,
        lastOpenedAt: 1,
      },
    ],
  });
  const params: Parameters<typeof reconnectRemoteWorkspaceHistoryEntry>[0] = {
    sessionEntry,
    activateTabByPath: vi.fn(() => false),
    setReconnectingRemoteWorkspaceKeys: vi.fn(),
    getSettings: vi.fn(async () => settings),
    loadCredential: vi.fn(async (key) => `${key}-value`),
    connectRemoteWorkspaceTarget: vi.fn(async () => "new-session"),
    resolveRemoteWorkspaceCanonicalPath: vi.fn(async () => sessionEntry.workspacePath),
    bindRemoteWorkspaceScope: vi.fn(async () => ({
      workspacePath: sessionEntry.workspacePath,
      workspaceIdentity: sessionEntry.workspaceIdentity!,
    })),
    disposeRemoteWorkspaceSession: vi.fn(async () => undefined),
    bindRemoteWorkspacePath: vi.fn(),
    bindRemoteWorkspaceIdentity: vi.fn(),
    upsertWorkspaceTab: vi.fn(),
    commitRemoteWorkspaceSessionMutation: vi.fn(async (mutation) => mutation.entry),
    getRemoteSessions: () => [sessionEntry],
    logger: { warn: vi.fn() },
    toast: vi.fn(),
    options: { requireStoredCredentials: true, throwOnFailure: true, showErrorToast: false },
  };
  return { params, settings, sessionEntry };
}

describe("SSH original project reconnection reads the latest Profile", () => {
  it.each(["manual", "automatic"] as const)(
    "%s resumes using the new address and credentials of the originally bound route, preserving project identity",
    async (recoveryMode) => {
      const { params, settings, sessionEntry } = setup();
      params.options = { ...params.options, recoveryMode };
      const otherProfileId = "8a116c93-1306-48a8-b8bf-4bdc318b8684";
      settings.connectionProfiles!.unshift({
        ...settings.connectionProfiles![0]!,
        profileId: otherProfileId,
        target: { ...updatedTarget, host: "other.example.com" },
      });
      settings.sourceServers = [
        {
          sourceServerId,
          displayName: "Device",
          preferredProfileId: otherProfileId,
          installState: "installed",
        },
      ];
      await reconnectRemoteWorkspaceHistoryEntry(params);
      expect(params.connectRemoteWorkspaceTarget).toHaveBeenCalledWith(
        {
          kind: "ssh",
          host: "new.example.com",
          port: 2222,
          username: "dev",
          password: "profile-password-value",
        },
        undefined,
        {
          workspacePath: sessionEntry.workspacePath,
          workspaceIdentity: sessionEntry.workspaceIdentity,
          connectTrigger: "reconnect",
        },
      );
      expect(params.loadCredential).toHaveBeenCalledExactlyOnceWith("profile-password");
      expect(params.upsertWorkspaceTab).toHaveBeenCalledWith(
        sessionEntry.workspacePath,
        expect.objectContaining({
          workspaceIdentity: sessionEntry.workspaceIdentity,
          remoteTarget: { kind: "ssh", host: "new.example.com", port: 2222, username: "dev" },
        }),
      );
      expect(params.commitRemoteWorkspaceSessionMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entry: expect.objectContaining({
            workspaceIdentity: sessionEntry.workspaceIdentity,
            target: expect.objectContaining({ host: "new.example.com", port: 2222 }),
          }),
        }),
      );
    },
  );

  it("After switching to an unencrypted private key, old passwords and private key passphrases are not inherited, and missing credentials are not falsely reported", async () => {
    const { params, sessionEntry } = setup({
      kind: "ssh",
      host: "new.example.com",
      username: "dev",
      privateKeyPath: "/keys/new-key",
    });
    sessionEntry.target = {
      ...oldTarget,
      privateKeyPath: "/keys/old-key",
      privateKeyPassphraseCredentialKey: "legacy-passphrase",
    };
    await reconnectRemoteWorkspaceHistoryEntry(params);
    expect(params.loadCredential).not.toHaveBeenCalled();
    expect(params.connectRemoteWorkspaceTarget).toHaveBeenCalledWith(
      { kind: "ssh", host: "new.example.com", username: "dev", privateKeyPath: "/keys/new-key" },
      undefined,
      expect.anything(),
    );
  });

  it("After switching from password to a passphrase-protected private key, use the new path and passphrase", async () => {
    const { params } = setup({
      kind: "ssh",
      host: "new.example.com",
      username: "dev",
      privateKeyPath: "/keys/new-key",
      privateKeyPassphraseCredentialKey: "profile-passphrase",
    });
    await reconnectRemoteWorkspaceHistoryEntry(params);
    expect(params.connectRemoteWorkspaceTarget).toHaveBeenCalledWith(
      {
        kind: "ssh",
        host: "new.example.com",
        username: "dev",
        privateKeyPath: "/keys/new-key",
        privateKeyPassphrase: "profile-passphrase-value",
      },
      undefined,
      expect.anything(),
    );
    expect(params.loadCredential).toHaveBeenCalledExactlyOnceWith("profile-passphrase");
  });

  it("When Profile has no new credential reference, maintain compatibility with old credentials of the same auth method, but still use the new address", async () => {
    const { params } = setup({ kind: "ssh", host: "new.example.com", username: "dev", port: 2222 });
    await reconnectRemoteWorkspaceHistoryEntry(params);
    expect(params.connectRemoteWorkspaceTarget).toHaveBeenCalledWith(
      {
        kind: "ssh",
        host: "new.example.com",
        username: "dev",
        port: 2222,
        password: "legacy-password-value",
      },
      undefined,
      expect.anything(),
    );
    expect(params.loadCredential).toHaveBeenCalledExactlyOnceWith("legacy-password");
  });

  it("Legacy history without a bound Profile continues to use the original address and credentials", async () => {
    const { params, settings } = setup();
    settings.sourceServerWorkspaceHistory = [];
    await reconnectRemoteWorkspaceHistoryEntry(params);
    expect(params.connectRemoteWorkspaceTarget).toHaveBeenCalledWith(
      {
        kind: "ssh",
        host: "old.example.com",
        port: 22,
        username: "old-user",
        password: "legacy-password-value",
      },
      undefined,
      expect.anything(),
    );
  });

  it("Reject connection when the new Profile\'s password is actually missing, without falling back to the old password", async () => {
    const { params } = setup();
    params.loadCredential = vi.fn(async (key) => (key === "legacy-password" ? "old-secret" : null));
    await expect(reconnectRemoteWorkspaceHistoryEntry(params)).rejects.toMatchObject({
      code: "credentials-required",
    });
    expect(params.connectRemoteWorkspaceTarget).not.toHaveBeenCalled();
    expect(params.loadCredential).toHaveBeenCalledExactlyOnceWith("profile-password");
  });

  it("Sibling uses the latest address and initiator credentials without re-reading this project\'s credentials", async () => {
    const { params } = setup();
    params.loadCredential = vi.fn(async () => {
      throw new Error("unexpected credential read");
    });
    params.options = {
      ...params.options,
      sshCredentialsOverride: { password: "initiator-secret", privateKeyPassphrase: null },
    };
    await reconnectRemoteWorkspaceHistoryEntry(params);
    expect(params.loadCredential).not.toHaveBeenCalled();
    expect(params.connectRemoteWorkspaceTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "new.example.com",
        port: 2222,
        password: "initiator-secret",
      }),
      undefined,
      expect.anything(),
    );
  });
});
