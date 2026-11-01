//
import type { CfPromptAttachment } from "@origin-ai/cf-shared";
import type {
  AttachmentRef,
  V4AttachmentPutParams,
  V4AttachmentPutResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { logger } from "@/logger.js";
import type { AttachmentUploadOptions } from "@/v4/attachmentUploadTransaction.js";

export type AttachmentPutFn = (
  params: V4AttachmentPutParams,
  options?: AttachmentUploadOptions,
) => Promise<V4AttachmentPutResult>;

function encodeTextToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ByteLength(dataBase64: string): number {
  const padding = dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0;
  return Math.floor((dataBase64.length * 3) / 4) - padding;
}

export async function uploadComposerAttachment(
  put: AttachmentPutFn,
  sessionId: string,
  attachment: CfPromptAttachment,
  options?: AttachmentUploadOptions,
): Promise<AttachmentRef | null> {
  const fileName = attachment.filename;
  const mime = attachment.mimeType;
  const source =
    attachment.kind === "file" && attachment.sourceKind
      ? { sourceKind: attachment.sourceKind, messageCount: attachment.messageCount }
      : {};
  const sizeBytes =
    "sizeBytes" in attachment && typeof attachment.sizeBytes === "number"
      ? attachment.sizeBytes
      : undefined;
  if (attachment.localPath) {
    return {
      ...source,
      ref: attachment.localPath,
      fileName,
      mime,
      bytes: sizeBytes ?? 0,
    };
  }
  const dataBase64 =
    "dataBase64" in attachment && attachment.dataBase64
      ? attachment.dataBase64
      : "textContent" in attachment && attachment.textContent !== undefined
        ? encodeTextToBase64(attachment.textContent)
        : null;
  if (dataBase64 === null) {
    logger.warn(
      `[v4-composer] Attachment无inner容可发（无 localPath/dataBase64/textContent），已丢弃: ${fileName}`,
    );
    return null;
  }
  const { ref } = await put({ sessionId, fileName, mime, dataBase64 }, options);
  return {
    ...source,
    ref,
    fileName,
    mime,
    bytes: sizeBytes ?? base64ByteLength(dataBase64),
  };
}

export async function uploadComposerAttachments(
  put: AttachmentPutFn,
  sessionId: string,
  attachments: readonly CfPromptAttachment[],
): Promise<AttachmentRef[]> {
  const refs: AttachmentRef[] = [];
  for (const attachment of attachments) {
    const ref = await uploadComposerAttachment(put, sessionId, attachment);
    if (ref) {
      refs.push(ref);
    }
  }
  return refs;
}
