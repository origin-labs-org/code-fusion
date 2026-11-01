import { useEffect, useState } from "react";
import type { SessionDebugSnapshot } from "@origin-ai/cf-shared";
import { useServices } from "@/hooks/useServices.js";

const REFRESH_INTERVAL_MS = 1000;
const EMPTY_DEBUG = { rounds: [], networkEntries: [], cache: null } as const;

export function useSessionDebug({
  workspacePath,
  workspaceIdentity,
  taskId,
  enabled = true,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string | null;
  enabled?: boolean;
}) {
  const { cfAgentService } = useServices();
  const scopeKey = JSON.stringify([workspaceIdentity?.trim() || workspacePath, taskId]);
  const [result, setResult] = useState<{
    key: string;
    service: typeof cfAgentService;
    data: SessionDebugSnapshot | null;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!enabled || !taskId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const data = await cfAgentService.readSessionDebug({
          workspacePath,
          workspaceIdentity,
          sessionId: taskId,
        });
        if (!disposed) setResult({ key: scopeKey, service: cfAgentService, data, error: false });
      } catch {
        if (!disposed)
          setResult((previous) => ({
            key: scopeKey,
            service: cfAgentService,
            data:
              previous?.key === scopeKey && previous.service === cfAgentService
                ? previous.data
                : null,
            error: true,
          }));
      } finally {
        if (!disposed) timer = setTimeout(() => void refresh(), REFRESH_INTERVAL_MS);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [enabled, scopeKey, taskId, workspaceIdentity, workspacePath, cfAgentService]);
  const current = result?.key === scopeKey && result.service === cfAgentService ? result : null;
  return { ...(current?.data ?? EMPTY_DEBUG), error: current?.error ?? false };
}
