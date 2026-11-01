import { useMemo } from "react";
import {
  remoteHostIdFromWorkspaceIdentity,
  type ProjectSidebarProps,
  type RemoteProjectDirectory,
} from "@/project-sidebar/contract.js";

export function useProjectConnectionDiagnostics(
  directory: RemoteProjectDirectory,
  props: ProjectSidebarProps,
) {
  return useMemo(
    () =>
      new Map(
        directory.hosts.map((host) => {
          const keys = new Set<string>(
            Object.keys(props.remoteWorkspaceErrorByWorkspaceKey ?? {})
              .concat(props.reconnectingRemoteWorkspaceKeys ?? [])
              .filter((key) => remoteHostIdFromWorkspaceIdentity(key) === host.id),
          );
          for (const entry of directory.entries)
            if (entry.hostId === host.id && entry.legacyWorkspace?.workspaceIdentity)
              keys.add(entry.legacyWorkspace.workspaceIdentity);
          return [
            host.id,
            {
              error:
                host.connectionStatus === "online"
                  ? undefined
                  : host.lastConnectionError ||
                    [...keys]
                      .map((key) => props.remoteWorkspaceErrorByWorkspaceKey?.[key])
                      .find(Boolean),
            },
          ];
        }),
      ),
    [directory, props.remoteWorkspaceErrorByWorkspaceKey, props.reconnectingRemoteWorkspaceKeys],
  );
}
