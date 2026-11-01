import type { WorkspaceTabState } from "@/store/tabStore.js";
import type { VirtualProject, RemoteProjectDirectory } from "@origin-ai/cf-services";
export {
  buildRemoteHostWorkspaceIdentity,
  buildRemoteWorkspaceIdentity,
  remoteTargetSchema,
  parseRemoteWorkspaceIdentity,
} from "@origin-ai/cf-shared";
export type { IServiceAccessor } from "@origin-ai/cf-services";
export type { VirtualProject, RemoteProjectDirectory };

export type ConfigWorkspaceTarget = Pick<
  WorkspaceTabState,
  | "workspacePath"
  | "workspaceIdentity"
  | "label"
  | "remoteSessionId"
  | "remoteTarget"
  | "localWorkspacePath"
  | "availability"
> & { hostId?: string; configOnline?: boolean };
export type {
  ProjectCatalogPort as ConfigCatalogPort,
  ProjectCatalogSnapshot as ConfigCatalogSnapshot,
} from "@origin-ai/cf-services";
