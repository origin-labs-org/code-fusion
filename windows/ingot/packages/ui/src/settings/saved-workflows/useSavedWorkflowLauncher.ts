import { useCallback, useRef, useState } from "react";
import {
  SAVED_WORKFLOW_START_REJECTED_FAULT_PREFIX,
  savedWorkflowStartRejectionReasonSchema,
  type CommandAck,
  type SavedWorkflowStartRejectionReason,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import {
  acquireWorkspaceConnection,
  type WorkspaceConnectionAgentService,
} from "@/v4/workspaceConnectionRegistry.js";
import { logger } from "@/logger.js";

export interface SavedWorkflowLaunchTarget {
  projectId?: string | null;
  hostId?: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

interface SavedWorkflowLaunchRequest {
  name: string;
  scope: "project" | "global";
  args: Record<string, unknown>;
}

export type SavedWorkflowLaunchErrorReason =
  | SavedWorkflowStartRejectionReason
  | "unsupported"
  | "generic";

export interface SavedWorkflowLaunchError {
  reason: SavedWorkflowLaunchErrorReason;
  
  code: string;
  
  message?: string;
}

type SavedWorkflowLaunchResult =
  | { ok: true; sessionId: string; runId: string; toolCallId: string }
  | { ok: false; error: SavedWorkflowLaunchError };

interface UseSavedWorkflowLauncherResult {
  launch: (
    target: SavedWorkflowLaunchTarget,
    request: SavedWorkflowLaunchRequest,
  ) => Promise<SavedWorkflowLaunchResult>;
  
  pending: boolean;
  
  error: SavedWorkflowLaunchError | null;
  clearError: () => void;
}

const CAPABILITY_UNSUPPORTED_FAULT = "fault.command.capabilityUnsupported";

export function launchWorkspaceId(target: SavedWorkflowLaunchTarget): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}

export function acquireLaunchLease(
  target: SavedWorkflowLaunchTarget,
  agentService: WorkspaceConnectionAgentService,
) {
  return acquireWorkspaceConnection(
    {
      workspacePath: target.workspacePath,
      ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
      ...(target.remoteSessionId ? { remoteSessionId: target.remoteSessionId } : {}),
    },
    agentService,
  );
}

function mapLaunchError(ack: CommandAck): SavedWorkflowLaunchError {
  const code = ack.reasonCode ?? ack.status;
  const message = ack.message;
  if (ack.reasonCode === CAPABILITY_UNSUPPORTED_FAULT) {
    return { reason: "unsupported", code, ...(message ? { message } : {}) };
  }
  if (ack.reasonCode?.startsWith(SAVED_WORKFLOW_START_REJECTED_FAULT_PREFIX)) {
    const suffix = ack.reasonCode.slice(SAVED_WORKFLOW_START_REJECTED_FAULT_PREFIX.length);
    const parsed = savedWorkflowStartRejectionReasonSchema.safeParse(suffix);
    if (parsed.success) return { reason: parsed.data, code, ...(message ? { message } : {}) };
  }
  return { reason: "generic", code, ...(message ? { message } : {}) };
}

export function useSavedWorkflowLauncher(params: {
  agentService: WorkspaceConnectionAgentService;
  onNavigate?: (target: SavedWorkflowLaunchTarget, sessionId: string) => void;
}): UseSavedWorkflowLauncherResult {
  const { agentService, onNavigate } = params;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SavedWorkflowLaunchError | null>(null);
  const pendingRef = useRef(false);

  const clearError = useCallback(() => setError(null), []);

  const launch = useCallback(
    async (
      target: SavedWorkflowLaunchTarget,
      request: SavedWorkflowLaunchRequest,
    ): Promise<SavedWorkflowLaunchResult> => {
      if (pendingRef.current) {
        return { ok: false, error: { reason: "generic", code: "launch_in_flight" } };
      }
      pendingRef.current = true;
      setPending(true);
      setError(null);

      const workspaceId = launchWorkspaceId(target);
      const lease = acquireLaunchLease(target, agentService);

      const deleteCreatedSession = (sessionId: string) => {
        void lease.transport
          .sendCommand(createCommandEnvelope({ type: "deleteSession", payload: {}, sessionId }))
          .then((ack) => {
            if (ack.status !== "accepted" && ack.status !== "noop") {
              logger.warn("[saved-workflow-launch] 回收空会话被拒", {
                sessionId,
                status: ack.status,
                reasonCode: ack.reasonCode ?? null,
              });
            }
          })
          .catch(() => {
          });
      };

      let createdSessionId: string | null = null;
      try {
        const createAck = await lease.transport.sendCommand(
          createCommandEnvelope({
            type: "createSession",
            payload: { workspaceId },
            sessionId: null,
          }),
          { projectId: target.projectId },
        );
        if (createAck.status !== "accepted" || createAck.result?.type !== "createSession") {
          logger.warn("[saved-workflow-launch] createSession 被拒", {
            workspaceId,
            status: createAck.status,
            reasonCode: createAck.reasonCode ?? null,
          });
          const err: SavedWorkflowLaunchError = {
            reason: "generic",
            code: createAck.reasonCode ?? createAck.status,
            ...(createAck.message ? { message: createAck.message } : {}),
          };
          setError(err);
          return { ok: false, error: err };
        }
        createdSessionId = createAck.result.sessionId;

        const startAck = await lease.transport.sendCommand(
          createCommandEnvelope({
            type: "startSavedWorkflow",
            payload: {
              name: request.name,
              scope: request.scope,
              ...(Object.keys(request.args).length > 0 ? { args: request.args } : {}),
            },
            sessionId: createdSessionId,
          }),
        );
        if (startAck.status === "accepted" && startAck.result?.type === "startSavedWorkflow") {
          onNavigate?.(target, createdSessionId);
          return {
            ok: true,
            sessionId: createdSessionId,
            runId: startAck.result.runId,
            toolCallId: startAck.result.toolCallId,
          };
        }
        deleteCreatedSession(createdSessionId);
        const err = mapLaunchError(startAck);
        setError(err);
        return { ok: false, error: err };
      } catch (thrown) {
        if (createdSessionId) deleteCreatedSession(createdSessionId);
        const err: SavedWorkflowLaunchError = {
          reason: "generic",
          code: "exception",
          message: thrown instanceof Error ? thrown.message : String(thrown),
        };
        setError(err);
        return { ok: false, error: err };
      } finally {
        lease.release();
        pendingRef.current = false;
        setPending(false);
      }
    },
    [agentService, onNavigate],
  );

  return { launch, pending, error, clearError };
}
