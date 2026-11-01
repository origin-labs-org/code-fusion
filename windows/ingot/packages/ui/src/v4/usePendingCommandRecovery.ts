import { useEffect, useState } from "react";
import type { ConversationSnapshot } from "@origin-ai/cf-shared/cf-protocol-v4";
import { logger } from "@/logger.js";
import { pendingCommandRegistry, type PendingCommandEntry } from "@/v4/pendingCommandRegistry.js";
import { isPendingCommandForWorkspace } from "@/v4/pendingCommandWorkspace.js";
import type { SessionDataLayer } from "@/v4/sessionDataLayer.js";

export interface UsePendingCommandRecoveryOptions {
  layer: SessionDataLayer;
  sessionId: string | null;
  snapshot: ConversationSnapshot | null;
  status: "connecting" | "live" | "error" | "closed";
  subscriptionId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
}

export function usePendingCommandRecovery({
  layer,
  sessionId,
  snapshot,
  status,
  subscriptionId,
  workspacePath,
  workspaceIdentity,
}: UsePendingCommandRecoveryOptions): readonly PendingCommandEntry[] {
  const [version, setVersion] = useState(0);

  useEffect(() => pendingCommandRegistry.subscribe(() => setVersion((current) => current + 1)), []);

  useEffect(() => {
    if (snapshot) pendingCommandRegistry.reconcileSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    if (status !== "live" || subscriptionId === null) return;
    const targets: Array<string | null> = sessionId === null ? [null] : [sessionId, null];
    void Promise.all(
      targets.map((target) =>
        pendingCommandRegistry.reconcileSession(
          target,
          (params) => layer.queryCommands(params),
          workspaceIdentity?.trim() || workspacePath,
        ),
      ),
    ).catch((error) => {
      logger.warn("[v4-pending-command] Reconnection reconciliation failed; keeping ledger for next connection", error);
    });
  }, [layer, sessionId, status, subscriptionId, workspacePath, workspaceIdentity]);

  void version;
  const scoped = pendingCommandRegistry.listRecoverable(sessionId);
  const recoverableCreates = pendingCommandRegistry
    .listRecoverable(null)
    .filter((entry) => isPendingCommandForWorkspace(entry, workspacePath, workspaceIdentity));
  return sessionId === null ? recoverableCreates : [...scoped, ...recoverableCreates];
}
