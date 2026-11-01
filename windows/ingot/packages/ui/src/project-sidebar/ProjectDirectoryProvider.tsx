import { useSourceServerDisplayNames } from "@/hooks/useSourceServerDisplayNames.js";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { countProjectTreeUnreadTasks } from "@/project-sidebar/view.js";
import { useProjectTree } from "@/project-sidebar/useProjectTree.js";
import { useProjectSidebarPreferences } from "@/project-sidebar/useProjectSidebarPreferences.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";
import { useTaskGroups } from "@/project-sidebar/useTaskGroups.js";
import { selectSortedProjects } from "@/project-sidebar/view.js";

function useDirectoryState(isDesktop: boolean) {
  const result = useProjectTree(isDesktop);
  const deviceNames = useSourceServerDisplayNames(isDesktop);
  const groups = useTaskGroups(result.factTree);
  const sortedProjects = useMemo(
    () => selectSortedProjects(result.factTree),
    [result.factTree.projects],
  );
  const preferences = useProjectSidebarPreferences(
    sortedProjects,
    result.loading,
    result.availability,
  );
  const projects = useMemo(() => {
    const sorted = preferences.sort(sortedProjects);
    return [...sorted.filter((p) => p.pinned), ...sorted.filter((p) => !p.pinned)];
  }, [sortedProjects, preferences.order]);
  return useMemo(
    () => ({ ...result, preferences, projects, groups, deviceNames }),
    [result, preferences, projects, groups, deviceNames],
  );
}
const Context = createContext<ReturnType<typeof useDirectoryState> | null>(null);

export function ProjectDirectoryProvider({
  children,
  isDesktop = false,
}: {
  children: ReactNode;
  isDesktop?: boolean;
}) {
  const existing = useContext(Context);
  return existing ? children : <DirectoryOwner isDesktop={isDesktop}>{children}</DirectoryOwner>;
}
function DirectoryOwner({ children, isDesktop }: { children: ReactNode; isDesktop: boolean }) {
  const directory = useDirectoryState(isDesktop);
  const platform = useOptionalPlatform();
  const notificationEnabled = useCfStoreWithDefault(
    (state) => state.notificationEnabled,
    true,
  );
  const unreadTaskCount = useMemo(
    () => countProjectTreeUnreadTasks(directory.tree),
    [directory.tree],
  );
  useEffect(() => {
    platform?.syncWindowUnreadCount(notificationEnabled ? unreadTaskCount : 0);
  }, [platform, notificationEnabled, unreadTaskCount]);
  return <Context.Provider value={directory}>{children}</Context.Provider>;
}
export function useProjectDirectory() {
  const directory = useContext(Context);
  if (!directory) throw new Error("project.directory-provider-required");
  return directory;
}

export function useOptionalProjectDirectory() {
  return useContext(Context);
}
