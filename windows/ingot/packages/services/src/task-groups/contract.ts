import { ServiceChannels, type CfTaskMeta } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export type TaskGroupColor = "gray" | "red" | "orange" | "yellow" | "green" | "blue" | "purple";
export interface TaskGroup {
  id: string;
  title: string;
  color: TaskGroupColor;
  createdAt: number;
  updatedAt: number;
}
export interface GroupTaskRef {
  hostId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}
export type GroupNode = { type: "group"; groupId: string } | { type: "task"; task: GroupTaskRef };
export interface TaskGroupStructure {
  groups: TaskGroup[];
  members: Array<{ groupId: string; workspaceKey: string; taskId: string; sortOrder: number }>;
  order: Array<{ type: "group" | "task"; key: string; sortOrder: number }>;
}
export interface MoveGroupNode {
  node: GroupNode;
  
  sourceGroupId: string | null;
  groupId: string | null;
  anchor?: { node: GroupNode; side: "before" | "after" };
}
export type GroupTaskFact = GroupTaskRef &
  Pick<CfTaskMeta, "cronAutomationId" | "offPeakTaskId"> & {
    createdAt?: number;
    archived?: boolean;
    deleted?: boolean;
  };
export interface ITaskGroupService {
  read(): Promise<TaskGroupStructure>;
  save(input: { id?: string; title?: string; color?: TaskGroupColor }): Promise<TaskGroup>;
  ungroup(id: string): Promise<void>;
  move(input: MoveGroupNode): Promise<void>;
  
  admit(input: {
    tasks: GroupTaskRef[];
    placement?: { task: GroupTaskRef; groupId: string | null; creationId: string };
  }): Promise<void>;
}
export const ITaskGroupService = createServiceDescriptor<ITaskGroupService>(
  ServiceChannels.TaskGroups,
);
