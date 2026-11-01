import {
  parseRemoteWorkspaceIdentity,
  type SourceServerConnectionStateSnapshot,
  type SourceServerManagementSnapshot,
  type SourceServerRecord,
  type SourceServerWorkspaceHistoryEntry,
  type WorkspacePurpose,
} from "@origin-ai/cf-shared";
import {
  buildAggregatedSourceStatusMap,
  type AggregatedSourceStatus,
} from "@/lib/remoteConnectionPresentation.js";
import { buildWorkspaceSessionKey } from "@/lib/remoteWorkspaceHistory.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

function getWorkspaceSourceServerId(
  tab: Pick<WorkspaceTabState, "workspaceIdentity" | "workspacePath" | "remoteTarget">,
  options: { workspaceHistory?: readonly SourceServerWorkspaceHistoryEntry[] } = {},
): string | null {
  if (tab.remoteTarget?.kind === "server") return null;
  const parsed = tab.workspaceIdentity ? parseRemoteWorkspaceIdentity(tab.workspaceIdentity) : null;
  if (parsed?.kind === "server") return parsed.sourceServerId ?? null;

  const legacyWorkspaceIdentity = tab.workspaceIdentity?.trim();
  if (!legacyWorkspaceIdentity) return null;
  const matchingSourceServerIds = new Set(
    options.workspaceHistory
      ?.filter(
        (entry) =>
          entry.workspacePath === tab.workspacePath &&
          entry.legacyWorkspaceIdentity?.trim() === legacyWorkspaceIdentity &&
          Boolean(entry.sourceServerId?.trim()),
      )
      .map((entry) => entry.sourceServerId!.trim()) ?? [],
  );
  return matchingSourceServerIds.size === 1
    ? (matchingSourceServerIds.values().next().value ?? null)
    : null;
}

export type WorkspaceAttachmentViewState =
  | "disconnected"
  | "attaching"
  | "ready"
  | "recovering"
  | "failed";

export interface RemoteWorkspaceAttachmentFact {
  remoteSessionId: string;
  workspaceKey: string;
  sourceServerId?: string;
  state?: WorkspaceAttachmentViewState;
}

export interface RemoteDeviceView {
  sourceServerId: string;
  displayName: string;
  osUser?: string;
  hostname?: string;
  aggregatedStatus: AggregatedSourceStatus;
  profiles: SourceServerManagementSnapshot["profiles"];
  knownProjects: SourceServerWorkspaceHistoryEntry[];
}

export interface RemoteOpenWorkspaceView {
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  purpose: WorkspacePurpose;
  sourceServerId?: string;
  sourceDisplayName?: string;
  sourceStatus?: AggregatedSourceStatus;
  remoteSessionId?: string;
  attachmentState: WorkspaceAttachmentViewState;
  lastConnectionError?: string;
}

export interface RemoteExecutionContextView {
  kind: "local" | "remote";
  workspaceKey: string;
  workspacePath: string;
  workspacePurpose: WorkspacePurpose;
  sourceServerId?: string;
  sourceDisplayName?: string;
  attachmentState?: WorkspaceAttachmentViewState;
}

export interface RemoteWorkspaceProjection {
  devices: RemoteDeviceView[];
  openWorkspaces: RemoteOpenWorkspaceView[];
  projectHistory: SourceServerWorkspaceHistoryEntry[];
  executionContexts: RemoteExecutionContextView[];
}

export interface RemoteWorkspaceProjectionInput {
  managementSnapshot?: SourceServerManagementSnapshot | null;
  tabs: readonly WorkspaceTabState[];
  attachments?: readonly RemoteWorkspaceAttachmentFact[];
  remoteConversationWorkspaceBySourceServerId?: AppSettingsConversationWorkspaceMap;
}

export type AppSettingsConversationWorkspaceMap = Readonly<
  Record<string, { workspacePath: string; lastResolvedAt: number }>
>;

function stateForOpenWorkspace(
  tab: WorkspaceTabState,
  attachment: RemoteWorkspaceAttachmentFact | undefined,
  sourceStatus: AggregatedSourceStatus | undefined,
): WorkspaceAttachmentViewState {
  if (attachment?.state) return attachment.state;
  if (!tab.remoteSessionId) return "disconnected";
  if (sourceStatus === "offline" || sourceStatus === "failed") return "disconnected";
  return "attaching";
}

export function isRemoteWorkspaceTab(tab: WorkspaceTabState): boolean {
  return Boolean(tab.remoteSessionId || tab.remoteTarget || tab.workspaceIdentity);
}

export function buildRemoteWorkspaceProjection(
  input: RemoteWorkspaceProjectionInput,
): RemoteWorkspaceProjection {
  const snapshot = input.managementSnapshot ?? null;
  const statuses = buildAggregatedSourceStatusMap(snapshot);
  const serverById = new Map(
    snapshot?.servers.map((server) => [server.sourceServerId, server]) ?? [],
  );
  const attachments = input.attachments ?? [];
  const attachmentBySessionId = new Map(
    attachments.map((attachment) => [attachment.remoteSessionId, attachment]),
  );
  const attachmentByWorkspaceKey = new Map(
    attachments.map((attachment) => [attachment.workspaceKey, attachment]),
  );

  const devices = (snapshot?.servers ?? []).map((server: SourceServerRecord) => ({
    sourceServerId: server.sourceServerId,
    displayName: server.displayName,
    ...(server.osUser ? { osUser: server.osUser } : {}),
    ...(server.hostname ? { hostname: server.hostname } : {}),
    aggregatedStatus: statuses.get(server.sourceServerId) ?? "offline",
    profiles: (snapshot?.profiles ?? []).filter(
      (profile) =>
        profile.sourceServerId === server.sourceServerId && profile.lifecycleState !== "retired",
    ),
    knownProjects: (snapshot?.workspaceHistory ?? []).filter(
      (entry) =>
        entry.sourceServerId === server.sourceServerId &&
        input.remoteConversationWorkspaceBySourceServerId?.[server.sourceServerId]
          ?.workspacePath !== entry.workspacePath,
    ),
  }));

  const remoteTabs = input.tabs.filter(isRemoteWorkspaceTab);
  const openWorkspaces = remoteTabs.map((tab): RemoteOpenWorkspaceView => {
    const workspaceKey = buildWorkspaceSessionKey(tab);
    const sourceServerId = getWorkspaceSourceServerId(tab, {
      workspaceHistory: snapshot?.workspaceHistory,
    });
    const source = sourceServerId ? serverById.get(sourceServerId) : undefined;
    const sourceStatus = sourceServerId ? statuses.get(sourceServerId) : undefined;
    const attachment =
      (tab.remoteSessionId ? attachmentBySessionId.get(tab.remoteSessionId) : undefined) ??
      attachmentByWorkspaceKey.get(workspaceKey);
    return {
      workspaceKey,
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      purpose: tab.workspacePurpose ?? "project",
      ...(sourceServerId ? { sourceServerId } : {}),
      ...(source?.displayName ? { sourceDisplayName: source.displayName } : {}),
      ...(sourceStatus ? { sourceStatus } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
      attachmentState: stateForOpenWorkspace(tab, attachment, sourceStatus),
    };
  });

  const projectHistory = (snapshot?.workspaceHistory ?? []).filter(
    (entry) =>
      entry.sourceServerId === undefined ||
      input.remoteConversationWorkspaceBySourceServerId?.[entry.sourceServerId]?.workspacePath !==
        entry.workspacePath,
  );

  const openWorkspaceByKey = new Map(
    openWorkspaces.map((workspace) => [workspace.workspaceKey, workspace]),
  );
  const executionContexts: RemoteExecutionContextView[] = input.tabs.map((tab) => {
    const open = isRemoteWorkspaceTab(tab)
      ? openWorkspaceByKey.get(buildWorkspaceSessionKey(tab))
      : undefined;
    return {
      kind: isRemoteWorkspaceTab(tab) ? "remote" : "local",
      workspaceKey: buildWorkspaceSessionKey(tab),
      workspacePath: tab.workspacePath,
      workspacePurpose: tab.workspacePurpose ?? "project",
      ...(open?.sourceServerId ? { sourceServerId: open.sourceServerId } : {}),
      ...(open?.sourceDisplayName ? { sourceDisplayName: open.sourceDisplayName } : {}),
      ...(open ? { attachmentState: open.attachmentState } : {}),
    };
  });

  return { devices, openWorkspaces, projectHistory, executionContexts };
}

export function resolveSourceStatus(
  snapshot: SourceServerManagementSnapshot | null | undefined,
  sourceServerId: string,
): AggregatedSourceStatus {
  return buildAggregatedSourceStatusMap(snapshot).get(sourceServerId) ?? "offline";
}

export function isSourceConnectionStateOnline(
  states: readonly SourceServerConnectionStateSnapshot[],
  sourceServerId: string,
): boolean {
  return states.some(
    (state) => state.sourceServerId === sourceServerId && state.state === "online",
  );
}
