import { createContext } from "react";
import type { ProjectTask } from "@/project-sidebar/contract.js";

export const ProjectTaskListContext = createContext<{
  isWebRemoteControl?: boolean;
  activeWorkspaceKey?: string;
  mobileActiveTaskKey?: string | null;
  onOpenTaskFiles?: (task: ProjectTask, remoteSessionId?: string) => Promise<void>;
  onPin?: (task: ProjectTask, pinned: boolean, commit: () => Promise<unknown>) => Promise<void>;
}>({});
