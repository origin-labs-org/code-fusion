import { Emitter } from "@origin-ai/cf-rpc";
import type { IRemoteBackend } from "@origin-ai/cf-server/remote";
import type {
  IPromptAttachmentTransferService,
  PromptAttachmentStageParams,
  PromptAttachmentStageResult,
  PromptAttachmentTransferProgress,
} from "@origin-ai/cf-services";
import type { CfPromptAttachment } from "@origin-ai/cf-shared";
import {
  cleanupRemotePromptAttachment,
  cleanupStaleRemotePromptAttachments,
  materializeRemotePromptAttachments,
} from "./remotePromptAttachments.js";

interface TransferRecord {
  controller: AbortController;
  ref?: string;
  bytes: number;
}

type AttachmentScope = Pick<
  PromptAttachmentStageParams,
  "workspacePath" | "workspaceIdentity" | "remoteSessionId"
>;

export type RemotePromptAttachmentTransferService = IPromptAttachmentTransferService & {
  dispose(): Promise<void>;
};

function canceled(): Error {
  return Object.assign(new Error("Remote attachment transfer canceled"), { name: "AbortError" });
}

export function createRemotePromptAttachmentTransferService(
  backend: Pick<IRemoteBackend, "exec" | "upload">,
  options: { scope?: AttachmentScope; onJanitorError?: (error: unknown) => void } = {},
): RemotePromptAttachmentTransferService {
  const records = new Map<string, TransferRecord>();
  const emitters = new Map<string, Emitter<PromptAttachmentTransferProgress>>();
  let disposed = false;

  void cleanupStaleRemotePromptAttachments(backend).catch((error) => {
    options.onJanitorError?.(error);
  });

  const getEmitter = (operationId: string) => {
    const existing = emitters.get(operationId);
    if (existing) return existing;
    const emitter = new Emitter<PromptAttachmentTransferProgress>({
      onDidRemoveLastListener: () => {
        emitters.delete(operationId);
        emitter.dispose();
      },
    });
    emitters.set(operationId, emitter);
    return emitter;
  };

  const cleanupRecord = async (operationId: string, record: TransferRecord) => {
    if (records.get(operationId) === record) records.delete(operationId);
    record.controller.abort();
    if (record.ref) await cleanupRemotePromptAttachment(backend, record.ref);
  };
  const cleanup = async (operationId: string) => {
    const record = records.get(operationId);
    if (record) {
      emitters
        .get(operationId)
        ?.fire({ operationId, phase: "canceled", uploadedBytes: 0, totalBytes: record.bytes });
      await cleanupRecord(operationId, record);
    }
  };

  return {
    async stage(params): Promise<PromptAttachmentStageResult> {
      if (disposed) throw new Error("Remote attachment transfer is disposed");
      if (
        options.scope &&
        (params.workspacePath !== options.scope.workspacePath ||
          params.workspaceIdentity !== options.scope.workspaceIdentity ||
          params.remoteSessionId !== options.scope.remoteSessionId)
      ) {
        throw new Error("Remote attachment scope mismatch");
      }
      const previous = records.get(params.operationId);
      const record: TransferRecord = {
        controller: new AbortController(),
        bytes: Math.max(0, params.sizeBytes ?? 0),
      };
      records.set(params.operationId, record);
      const isCurrent = () =>
        !disposed &&
        !record.controller.signal.aborted &&
        records.get(params.operationId) === record;
      const emitter = getEmitter(params.operationId);
      let lastPercent = -1;
      let lastEmittedAt = 0;
      let lastUploadedBytes = 0;
      try {
        if (previous) await cleanupRecord(params.operationId, previous);
        if (!isCurrent()) throw canceled();
        const attachment: CfPromptAttachment = {
          kind: params.mime.startsWith("image/") ? "image" : "file",
          filename: params.fileName,
          localPath: params.localPath,
          mimeType: params.mime,
          sizeBytes: params.sizeBytes ?? 0,
        } as CfPromptAttachment;
        const workspaceKey = params.workspaceIdentity?.trim() || params.workspacePath;
        const materialized = await materializeRemotePromptAttachments(
          {
            taskId: params.sessionId,
            traceId: `${workspaceKey}\u0000${params.remoteSessionId ?? ""}\u0000${params.operationId}`,
            content: "",
            attachments: [attachment],
          },
          {
            backend,
            uploadOptions: {
              signal: record.controller.signal,
              onProgress(progress) {
                if (!isCurrent()) return;
                const totalBytes = Math.max(progress.totalBytes, record.bytes);
                record.bytes = totalBytes;
                lastUploadedBytes = Math.max(lastUploadedBytes, progress.uploadedBytes);
                const percent =
                  totalBytes > 0 ? Math.floor((lastUploadedBytes / totalBytes) * 100) : 0;
                const now = Date.now();
                if (percent <= lastPercent && now - lastEmittedAt < 100) return;
                lastPercent = Math.max(lastPercent, percent);
                lastEmittedAt = now;
                emitter.fire({
                  operationId: params.operationId,
                  phase: "uploading",
                  uploadedBytes: lastUploadedBytes,
                  totalBytes,
                });
              },
            },
          },
        );
        const ref = materialized.attachments?.[0]?.localPath?.trim();
        if (!ref) throw new Error("Remote attachment staging returned no path");
        record.ref = ref;
        if (!isCurrent()) throw canceled();
        for (const phase of ["committing", "complete"] as const) {
          if (!isCurrent()) throw canceled();
          emitter.fire({
            operationId: params.operationId,
            phase,
            uploadedBytes: record.bytes,
            totalBytes: record.bytes,
          });
        }
        return { operationId: params.operationId, ref, bytes: record.bytes, staged: true };
      } catch (error) {
        const aborted = record.controller.signal.aborted;
        if (aborted && records.get(params.operationId) === record) {
          emitter.fire({
            operationId: params.operationId,
            phase: "canceled",
            uploadedBytes: 0,
            totalBytes: record.bytes,
          });
        }
        await cleanupRecord(params.operationId, record).catch(() => {});
        if (aborted) throw canceled();
        throw error;
      }
    },
    async adopt(operationId) {
      if (records.get(operationId)?.ref) records.delete(operationId);
    },
    cancel: cleanup,
    cleanup,
    onDynamicProgress: (operationId) => getEmitter(operationId).event,
    async dispose() {
      if (disposed) return;
      disposed = true;
      const pending = [...records].map(([id, record]) => cleanupRecord(id, record));
      for (const emitter of emitters.values()) emitter.dispose();
      emitters.clear();
      await Promise.allSettled(pending);
    },
  };
}
