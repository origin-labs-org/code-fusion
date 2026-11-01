import type { AgentRuntimeInternal } from "./internal.js";

export const unpublishedPermissionGrants = new WeakMap<
  AgentRuntimeInternal,
  {
    interactionId: string;
    recover: () => Promise<string>;
  }
>();

export async function recoverPendingPermissionGrant(runtime: AgentRuntimeInternal): Promise<void> {
  await unpublishedPermissionGrants.get(runtime)?.recover();
}
