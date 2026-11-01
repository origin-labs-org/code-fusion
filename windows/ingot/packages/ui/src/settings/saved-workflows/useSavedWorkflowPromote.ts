//
//
import { useCallback, useRef, useState } from "react";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import type { WorkspaceConnectionAgentService } from "@/v4/workspaceConnectionRegistry.js";
import { logger } from "@/logger.js";
import { buildSavedWorkflowPromotePrompt } from "@/settings/saved-workflows/savedWorkflowLaunchPrompt.js";
import {
  acquireLaunchLease,
  launchWorkspaceId,
  type SavedWorkflowLaunchTarget,
} from "@/settings/saved-workflows/useSavedWorkflowLauncher.js";

interface SavedWorkflowPromoteRequest {
  name: string;
  path: string;
  locale: string;
}

type SavedWorkflowPromoteResult =
  | { ok: true; sessionId: string }
  | {
      ok: false;
      
      code: string;
      
      message?: string;
    };

interface UseSavedWorkflowPromoteResult {
  promote: (
    target: SavedWorkflowLaunchTarget,
    request: SavedWorkflowPromoteRequest,
  ) => Promise<SavedWorkflowPromoteResult>;
  
  pending: boolean;
}

export function useSavedWorkflowPromote(params: {
  agentService: WorkspaceConnectionAgentService;
  onNavigate?: (target: SavedWorkflowLaunchTarget, sessionId: string) => void;
}): UseSavedWorkflowPromoteResult {
  const { agentService, onNavigate } = params;
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const promote = useCallback(
    async (
      target: SavedWorkflowLaunchTarget,
      request: SavedWorkflowPromoteRequest,
    ): Promise<SavedWorkflowPromoteResult> => {
      if (pendingRef.current) {
        return { ok: false, code: "promote_in_flight" };
      }
      pendingRef.current = true;
      setPending(true);
      const lease = acquireLaunchLease(target, agentService);
      try {
        const ack = await lease.transport.sendCommand(
          createCommandEnvelope({
            type: "createSession",
            payload: {
              workspaceId: launchWorkspaceId(target),
              firstInput: { text: buildSavedWorkflowPromotePrompt(request) },
            },
            sessionId: null,
          }),
          { projectId: target.projectId },
        );
        if (ack.status !== "accepted" || ack.result?.type !== "createSession") {
          logger.warn("[saved-workflow-promote] createSession(firstInput) 被拒", {
            workspacePath: target.workspacePath,
            name: request.name,
            status: ack.status,
            reasonCode: ack.reasonCode ?? null,
          });
          return {
            ok: false,
            code: ack.reasonCode ?? ack.status,
            ...(ack.message ? { message: ack.message } : {}),
          };
        }
        onNavigate?.(target, ack.result.sessionId);
        return { ok: true, sessionId: ack.result.sessionId };
      } catch (thrown) {
        return {
          ok: false,
          code: "exception",
          message: thrown instanceof Error ? thrown.message : String(thrown),
        };
      } finally {
        lease.release();
        pendingRef.current = false;
        setPending(false);
      }
    },
    [agentService, onNavigate],
  );

  return { promote, pending };
}
