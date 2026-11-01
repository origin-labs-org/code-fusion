import type { CfSessionStateSnapshot } from "@origin-ai/cf-shared";
import type {
  CfSessionWorkspaceTarget,
  CfTaskTarget,
} from "#src/cf-session/cfSession.js";

function getWorkspaceKey(target: CfSessionWorkspaceTarget): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}

function getSessionScopedKey(target: CfTaskTarget): string {
  return `${getWorkspaceKey(target)}\0${target.sessionId}`;
}

export function createCfDeferredDraftRegistry() {
  const sessionKeys = new Set<string>();

  return {
    remember(params: CfSessionWorkspaceTarget, snapshot: CfSessionStateSnapshot): void {
      sessionKeys.add(
        getSessionScopedKey({
          workspacePath: snapshot.session.workspace.workspacePath,
          workspaceIdentity:
            snapshot.session.workspace.workspaceIdentity ?? params.workspaceIdentity,
          sessionId: snapshot.session.sessionId,
        }),
      );
    },

    has(target: CfTaskTarget): boolean {
      return sessionKeys.has(getSessionScopedKey(target));
    },

    forget(target: CfTaskTarget): void {
      sessionKeys.delete(getSessionScopedKey(target));
    },
  };
}
