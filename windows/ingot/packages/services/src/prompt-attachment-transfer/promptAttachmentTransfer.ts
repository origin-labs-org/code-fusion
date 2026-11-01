import type { Event } from "@origin-ai/cf-rpc";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export type PromptAttachmentTransferPhase = "uploading" | "committing" | "complete" | "canceled";

export interface PromptAttachmentTransferProgress {
  operationId: string;
  phase: PromptAttachmentTransferPhase;
  uploadedBytes: number;
  totalBytes: number;
}

export interface PromptAttachmentStageParams {
  operationId: string;
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  localPath: string;
  fileName: string;
  mime: string;
  sizeBytes?: number;
}

export interface PromptAttachmentStageResult {
  operationId: string;
  ref: string;
  bytes: number;
  staged: boolean;
}

export interface IPromptAttachmentTransferService {
  stage(params: PromptAttachmentStageParams): Promise<PromptAttachmentStageResult>;
  adopt(operationId: string): Promise<void>;
  cancel(operationId: string): Promise<void>;
  cleanup(operationId: string): Promise<void>;
  onDynamicProgress(operationId: string): Event<PromptAttachmentTransferProgress>;
}

export const IPromptAttachmentTransferService =
  createServiceDescriptor<IPromptAttachmentTransferService>(
    ServiceChannels.PromptAttachmentTransfer,
  );
