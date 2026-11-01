import { useCallback, useRef } from "react";
import { ensureAgentV4ConnectionHandshake } from "@/v4/agentV4ConnectionHandshake.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import { resolveWorkspaceRemoteSessionId } from "@/lib/workspaceServiceResolver.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { sendInteractionAutoResolutionSnooze } from "@/v4/interactionAutoResolutionCommand.js";

export interface TaskInteractionAutoResolutionTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  sessionId: string;
}

export function useTaskInteractionAutoResolutionSnooze(
  target: TaskInteractionAutoResolutionTarget,
) {
  const loggedInteractionIdsRef = useRef(new Set<string>());
  const contextServices = useOptionalServices();
  const workspaceIdentity = target.workspaceIdentity?.trim() || undefined;
  const remoteSessionId = target.remoteSessionId?.trim() || undefined;
  const isRemoteTarget = Boolean(workspaceIdentity || remoteSessionId);
  const selectTargetServices = useCallback(
    (state: ReturnType<typeof useRemoteWorkspaceSessionStore.getState>) => {
      if (!isRemoteTarget) {
        return state.baseServices ?? contextServices;
      }

      const resolvedRemoteSessionId = resolveWorkspaceRemoteSessionId(
        {
          workspacePath: target.workspacePath,
          workspaceIdentity,
          remoteSessionId,
          remoteTarget: remoteSessionId ? true : undefined,
        },
        state,
      );
      if (resolvedRemoteSessionId) {
        return state.sessionsById[resolvedRemoteSessionId]?.services ?? null;
      }
      return null;
    },
    [contextServices, isRemoteTarget, remoteSessionId, target.workspacePath, workspaceIdentity],
  );
  const targetServices = useRemoteWorkspaceSessionStore(selectTargetServices);

  return useCallback(
    async (interactionId: string): Promise<boolean> => {
      const agentService = targetServices?.cfAgentService;
      if (!agentService) {
        logger.warn("[task-interaction] Target workspace not connected when pausing auto-end", {
          interactionId,
          sessionId: target.sessionId,
          workspaceKey: workspaceIdentity ?? target.workspacePath,
        });
        return false;
      }
      if (!loggedInteractionIdsRef.current.has(interactionId)) {
        loggedInteractionIdsRef.current.add(interactionId);
        logger.debug("[task-interaction] User requested to pause auto-end from sidebar", {
          interactionId,
          sessionId: target.sessionId,
          source: "taskBadge",
        });
      }

      return sendInteractionAutoResolutionSnooze({
        sessionId: target.sessionId,
        interactionId,
        source: "taskBadge",
        sendCommand: async (envelope) => {
          await ensureAgentV4ConnectionHandshake(agentService);
          return agentService.sendConversationCommandV4({
            workspacePath: target.workspacePath,
            ...(workspaceIdentity ? { workspaceIdentity } : {}),
            envelope,
          });
        },
      });
    },
    [target.sessionId, target.workspacePath, targetServices, workspaceIdentity],
  );
}
