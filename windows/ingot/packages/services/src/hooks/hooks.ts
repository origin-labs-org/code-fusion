import type { Hook, CfWorkspaceHookTrustGrantResult } from "@origin-ai/cf-shared";
import type { WorkspaceHookBundleSnapshotData } from "@origin-ai/cf-shared/workspace-hook-discovery";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IHooksService {
  
  loadHooks(params: {
    workspaceIdentity?: string;
    workspacePath: string;
    
    scope?: "all" | "user";
  }): Promise<{
    hooks: Hook[];
    hooksEnabled: boolean;
    workspaceHookSnapshot?: WorkspaceHookBundleSnapshotData;
    
    trustStoreCorrupt?: boolean;
  }>;

  
  saveHooks(params: {
    workspaceIdentity?: string;
    workspacePath: string;
    scope?: "all" | "user";
    hooks: Hook[];
  }): Promise<void>;

  
  grantWorkspaceHookTrust?(params: {
    workspaceIdentity?: string;
    workspacePath: string;
    bundleDigest: string;
    hookDeclarationDigest: string;
  }): Promise<CfWorkspaceHookTrustGrantResult>;
}

export const IHooksService = createServiceDescriptor<IHooksService>(ServiceChannels.Hooks);
