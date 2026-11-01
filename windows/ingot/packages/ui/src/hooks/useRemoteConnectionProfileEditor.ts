import { useCallback, useState } from "react";
import type { ConnectionProfile } from "@origin-ai/cf-shared";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

export function useRemoteConnectionProfileEditor() {
  const management = useBaseWorkspaceServices().sourceServerManagementService;
  const [editing, setEditing] = useState<{
    profile: ConnectionProfile;
    focusField: "host" | "auth";
  } | null>(null);
  const openEditor = useCallback(
    async (profileId: string, focusField: "host" | "auth") => {
      if (!management) return;
      const snapshot = await management.getSnapshot();
      const profile = snapshot.profiles.find(
        (candidate) => candidate.profileId === profileId && candidate.lifecycleState !== "retired",
      );
      if (!profile)
        throw Object.assign(new Error("Connection profile unavailable"), {
          code: "connection-profile-unavailable",
        });
      setEditing({ profile, focusField });
    },
    [management],
  );
  return { management, editing, openEditor, closeEditor: () => setEditing(null) };
}
