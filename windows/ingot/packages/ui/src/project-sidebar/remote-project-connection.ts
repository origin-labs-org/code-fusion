import type { IRemoteProjectService, RemoteProjectDirectory } from "@/project-sidebar/contract.js";
import {
  buildRemoteHostWorkspaceIdentity,
  buildServerRemoteWorkspaceIdentity,
} from "@/project-sidebar/contract.js";
import type { SourceServerManagementSnapshot } from "@origin-ai/cf-shared";
import type { RemoteConnectionOpenPreference } from "@/app-shell/types.js";
import { getWorkspaceSourceServerId } from "@/conversation-workspace-target/sourceIdentity.js";
import {
  buildRemoteTargetFromProfile,
  findPreferredSourceConnectionProfile,
} from "@/lib/remoteConnectionWizard.js";
import { resolveRemoteConnectionPresentation } from "@/lib/remoteConnectionPresentation.js";
import { requestRemoteProjectConnection } from "@/remote-connection-flow/contract.js";

export function resolveRecentRemoteProjectPreference(
  directory: RemoteProjectDirectory,
  input: { sourceServerId: string; path: string; profileId?: string },
): RemoteConnectionOpenPreference | null {
  const identity = buildServerRemoteWorkspaceIdentity({
    serverId: input.sourceServerId,
    workspacePath: input.path,
  });
  const entries = directory.entries.filter(
    (entry) =>
      directory.hosts.some((host) => host.id === entry.hostId) &&
      [...entry.roots.map((root) => root.rootPath), entry.legacyWorkspace?.workspacePath].some(
        (path) => path && buildRemoteHostWorkspaceIdentity(entry.hostId, path) === identity,
      ),
  );
  if (entries.length !== 1) return null;
  return {
    ...(input.profileId
      ? { preferredProfileId: input.profileId }
      : { preferredSourceServerId: input.sourceServerId }),
    preferredDirectoryPath: input.path,
    preferredProjectEntryId: entries[0]!.id,
  };
}

export async function requestRetainedRemoteProjectConnection(input: {
  workspaceKey: string;
  service: IRemoteProjectService;
  getSnapshot?: () => Promise<SourceServerManagementSnapshot>;
  openWizard: (preference: RemoteConnectionOpenPreference) => void;
}) {
  const directory = await input.service.readDirectory();
  const pathForEntry = (entry: (typeof directory.entries)[number]) =>
    entry.roots.find(
      (root) =>
        buildRemoteHostWorkspaceIdentity(entry.hostId, root.rootPath) === input.workspaceKey,
    )?.rootPath ??
    (entry.legacyWorkspace &&
    buildRemoteHostWorkspaceIdentity(entry.hostId, entry.legacyWorkspace.workspacePath) ===
      input.workspaceKey
      ? entry.legacyWorkspace.workspacePath
      : undefined);
  const entry = directory.entries.find((candidate) => pathForEntry(candidate));
  const host = directory.hosts.find((candidate) => candidate.id === entry?.hostId);
  const path = entry && pathForEntry(entry);
  if (!entry || !host || !path) throw new Error("remote-project.entry-not-found");
  if (host.kind === "server") {
    await input.service.connectHost(host.id);
    return;
  }
  const stillRetained = async () => {
    const current = await input.service.readDirectory();
    return (
      current.hosts.some(
        (candidate) => candidate.id === host.id && candidate.membershipId === host.membershipId,
      ) &&
      current.entries.some(
        (candidate) => candidate.id === entry.id && pathForEntry(candidate) === path,
      )
    );
  };
  const snapshot = await input.getSnapshot?.();
  if (!(await stillRetained())) return;
  const sourceId = getWorkspaceSourceServerId(
    {
      workspacePath: path,
      workspaceIdentity: input.workspaceKey,
      remoteTarget: host.target ?? undefined,
    },
    { workspaceHistory: snapshot?.workspaceHistory },
  );
  const profile =
    snapshot && sourceId ? findPreferredSourceConnectionProfile(snapshot, sourceId) : undefined;
  const state = snapshot?.states.find((candidate) => candidate.profileId === profile?.profileId);
  const server = snapshot?.servers.find((candidate) => candidate.sourceServerId === sourceId);
  let pendingWizard: RemoteConnectionOpenPreference | undefined;
  await requestRemoteProjectConnection({
    preference: {
      preferredDirectoryPath: path,
      preferredProjectEntryId: entry.id,
      preferredProfileId: profile?.profileId,
      preferredTarget: profile ? buildRemoteTargetFromProfile(profile) : (host.target ?? undefined),
    },
    presentation: resolveRemoteConnectionPresentation({
      ...state,
      installState: server?.installState,
      projectError: profile ? undefined : host.lastConnectionError,
    }),
    failure: {
      code: state?.errorCode,
      message: state?.error ?? (profile ? "" : (host.lastConnectionError ?? "")),
    },
    reconnect: async () => {
      await input.service.connectHost(host.id);
    },
    openWizard: (preference) => {
      pendingWizard = preference;
    },
  });
  if (pendingWizard && (await stillRetained())) input.openWizard(pendingWizard);
}
