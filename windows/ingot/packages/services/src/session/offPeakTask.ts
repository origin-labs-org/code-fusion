import type {
  OffPeakCodingPlanSupport,
  OffPeakTaskCreateResult,
  OffPeakTakeNumberAvailability,
  CfOffPeakTask,
  CfOffPeakTaskCreateParams,
  ModelSelection,
} from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface OffPeakUpdateTaskParams {
  title?: string;
  prompt?: string;
  permissionMode?: string;
  
  modelSelection?: ModelSelection | null;
}

export interface IOffPeakTaskService {
  
  getCodingPlanSupport(): Promise<OffPeakCodingPlanSupport>;
  
  getTakeNumberAvailability(): Promise<OffPeakTakeNumberAvailability>;
  
  createTask(params: CfOffPeakTaskCreateParams): Promise<OffPeakTaskCreateResult>;
  cancelTask(offPeakTaskId: string): Promise<CfOffPeakTask | null>;
  pauseTask(offPeakTaskId: string): Promise<CfOffPeakTask | null>;
  continueTask(offPeakTaskId: string): Promise<CfOffPeakTask | null>;
  deleteTask(offPeakTaskId: string): Promise<void>;
  
  deleteHistory(offPeakTaskId: string): Promise<CfOffPeakTask | null>;
  updateTask(
    offPeakTaskId: string,
    params: OffPeakUpdateTaskParams,
  ): Promise<CfOffPeakTask | null>;
  list(): Promise<CfOffPeakTask[]>;
  get(offPeakTaskId: string): Promise<CfOffPeakTask | null>;
}

export const IOffPeakTaskService = createServiceDescriptor<IOffPeakTaskService>(
  ServiceChannels.OffPeakTask,
);
