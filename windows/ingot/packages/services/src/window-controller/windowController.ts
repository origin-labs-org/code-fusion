import type { Event } from "@origin-ai/cf-rpc";
import { ServiceChannels } from "@origin-ai/cf-shared";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import type {
  ControllerResyncParams,
  ControllerResyncResult,
  ControllerSubscribeParams,
  ControllerSubscribeResult,
  ControllerUnsubscribeParams,
  WindowHostControllerTaskFrame,
  WindowHostControllerTaskRow,
  WindowHostControllerWorkspaceFrame,
  WindowHostTaskAddress,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { createServiceDescriptor } from "../descriptors.js";
import type { CfArchivedTaskDeletionResult } from "#src/session/cfTaskService.js";
import type {
  CfTaskListItem,
  CfTaskListQuery,
  CfTaskListResult,
} from "../session/cfTaskListTypes.js";

export type WindowHostControllerMutation =
  | { kind: "rename"; title: string }
  | { kind: "pin"; pinned: boolean }
  | { kind: "archive"; archived: boolean }
  | { kind: "delete" }
  | { kind: "delete-archived" }
  | { kind: "mark-read"; expectedUnreadAt?: number }
  | { kind: "mark-unread" }
  | { kind: "open" }
  | { kind: "resume" };

export type WindowHostControllerTaskListItem = CfTaskListItem & {
  sourceServerId?: string;
  serverDisplayName?: string;
  remoteSessionId?: string;
  sourceAvailability: "online" | "offline";
  liveStatus: WindowHostControllerTaskRow["liveStatus"];
  activity?: WindowHostControllerTaskRow["activity"];
};

export interface WindowHostControllerTaskListResult extends Omit<CfTaskListResult, "items"> {
  items: WindowHostControllerTaskListItem[];
}

export type WindowHostControllerFrame =
  | WindowHostControllerTaskFrame
  | WindowHostControllerWorkspaceFrame;

export interface WindowHostTaskUnreadSignal {
  address: WindowHostTaskAddress;
  updatedAt: number;
  status: "completed" | "error";
}

export interface IWindowControllerService {
  deleteArchivedTask(params: { address: WindowHostTaskAddress }): Promise<boolean>;
  deleteArchivedTasks(params: {
    address: WindowHostTaskAddress;
    taskIds: string[];
  }): Promise<CfArchivedTaskDeletionResult>;
  listTaskList(params: CfTaskListQuery): Promise<WindowHostControllerTaskListResult>;
  
  getTaskMeta(params: { address: WindowHostTaskAddress }): Promise<CfTaskMeta | null>;
  mutateTask(params: {
    address: WindowHostTaskAddress;
    mutation: WindowHostControllerMutation;
  }): Promise<CfTaskMeta | null>;
  subscribeControllerV4(params: ControllerSubscribeParams): Promise<ControllerSubscribeResult>;
  resyncControllerV4(params: ControllerResyncParams): Promise<ControllerResyncResult>;
  unsubscribeControllerV4(params: ControllerUnsubscribeParams): Promise<void>;
  onDynamicControllerFrame(): Event<WindowHostControllerFrame>;
  onDynamicTaskUnreadSignal(): Event<WindowHostTaskUnreadSignal>;
}

export const IWindowControllerService = createServiceDescriptor<IWindowControllerService>(
  ServiceChannels.WindowController,
);
