import { useMemo, type ReactNode } from "react";
import { usePluginReferenceCatalog } from "@/hooks/usePluginReferenceCatalog.js";
import { PluginReferenceIconProvider } from "@/v4/pluginReferenceIconContext.js";
import { buildSessionPluginIconMap } from "@/v4/pluginReferenceIconProjection.js";

interface SessionPluginReferenceIconProviderProps {
  children: ReactNode;
  enabled: boolean;
  remoteSessionId?: string | null;
  sessionId: string | null;
  workspaceIdentity?: string;
  workspacePath: string;
}

interface ActiveSessionPluginReferenceIconProviderProps extends Omit<
  SessionPluginReferenceIconProviderProps,
  "enabled" | "sessionId"
> {
  sessionId: string;
}

function ActiveSessionPluginReferenceIconProvider({
  children,
  remoteSessionId,
  sessionId,
  workspaceIdentity,
  workspacePath,
}: ActiveSessionPluginReferenceIconProviderProps) {
  const catalog = usePluginReferenceCatalog(workspacePath, workspaceIdentity, sessionId, true, {
    dedupeSessionRequest: true,
    preferredRemoteSessionId: remoteSessionId ?? undefined,
    suppressErrorLog: true,
  });
  const iconByPluginId = useMemo(
    () => buildSessionPluginIconMap(catalog.authority, catalog.entries),
    [catalog.authority, catalog.entries],
  );
  const projection = useMemo(
    () => (catalog.authority === "session" ? { sessionId, iconByPluginId } : null),
    [catalog.authority, iconByPluginId, sessionId],
  );

  return <PluginReferenceIconProvider value={projection}>{children}</PluginReferenceIconProvider>;
}

export function SessionPluginReferenceIconBoundary({
  children,
  enabled,
  remoteSessionId,
  sessionId,
  workspaceIdentity,
  workspacePath,
}: SessionPluginReferenceIconProviderProps) {
  if (!enabled || !sessionId) {
    return <PluginReferenceIconProvider value={null}>{children}</PluginReferenceIconProvider>;
  }

  return (
    <ActiveSessionPluginReferenceIconProvider
      remoteSessionId={remoteSessionId}
      sessionId={sessionId}
      workspaceIdentity={workspaceIdentity}
      workspacePath={workspacePath}
    >
      {children}
    </ActiveSessionPluginReferenceIconProvider>
  );
}
