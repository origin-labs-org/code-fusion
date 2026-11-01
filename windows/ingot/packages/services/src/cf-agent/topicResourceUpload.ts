import {
  V4_METHODS,
  v4AttachmentBeginResultSchema,
  v4AttachmentChunkResultSchema,
  v4AttachmentCommitResultSchema,
  v4AttachmentAbortResultSchema,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  cfTopicResourceReadResultSchema,
  type CfPromptAttachment,
  type CfProtocolTrace,
} from "@origin-ai/cf-shared";
import { uploadBotGroupAttachments } from "./groupAttachmentUpload.js";
import type { CfProtocolClient } from "./cfProtocolClient.js";
import type { CfAgentSessionTarget } from "./cfAgent.js";

export async function uploadTopicResourceToClient(
  client: Pick<CfProtocolClient, "request">,
  connectionId: string,
  target: CfAgentSessionTarget,
  attachment: CfPromptAttachment,
  signal: AbortSignal,
  trace?: CfProtocolTrace,
) {
  const [ref] = await uploadBotGroupAttachments(
    {
      attachmentBeginV4: (p) =>
        client.request(
          V4_METHODS.attachmentBegin,
          {
            connectionId,
            uploadId: p.uploadId,
            sessionId: p.sessionId,
            fileName: p.fileName,
            mime: p.mime,
            totalBytes: p.totalBytes,
            totalChunks: p.totalChunks,
            checksum: p.checksum,
          },
          v4AttachmentBeginResultSchema,
          { signal, trace },
        ),
      attachmentChunkV4: (p) =>
        client.request(
          V4_METHODS.attachmentChunk,
          {
            connectionId,
            uploadId: p.uploadId,
            sessionId: p.sessionId,
            chunkIndex: p.chunkIndex,
            dataBase64: p.dataBase64,
          },
          v4AttachmentChunkResultSchema,
          { signal, trace },
        ),
      attachmentCommitV4: (p) =>
        client.request(
          V4_METHODS.attachmentCommit,
          {
            connectionId,
            uploadId: p.uploadId,
            sessionId: p.sessionId,
          },
          v4AttachmentCommitResultSchema,
          { signal, trace },
        ),
      attachmentAbortV4: async (p) => {
        await client.request(
          V4_METHODS.attachmentAbort,
          {
            connectionId,
            uploadId: p.uploadId,
            sessionId: p.sessionId,
          },
          v4AttachmentAbortResultSchema,
        );
      },
    },
    target,
    [attachment],
    signal,
  );
  return cfTopicResourceReadResultSchema.parse(ref);
}
