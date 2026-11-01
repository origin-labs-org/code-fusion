//
import type { TurnAttachment } from "@origin-ai/cf-core";
import type { AttachmentRef } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { CfApp } from "../../app/types.js";

const URI_REF_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;
const INLINE_TEXT_ATTACHMENT_MAX_BYTES = 64 * 1024;

export function isUriAttachmentRef(ref: string): boolean {
  return URI_REF_PATTERN.test(ref);
}

function displayMetaOf(
  ref: AttachmentRef,
): Pick<TurnAttachment, "filename" | "mimeType" | "sizeBytes" | "sourceKind" | "messageCount"> {
  return {
    filename: ref.fileName,
    mimeType: ref.mime,
    sizeBytes: ref.bytes,
    ...(ref.sourceKind ? { sourceKind: ref.sourceKind, messageCount: ref.messageCount } : {}),
  };
}

function isImageRef(ref: AttachmentRef): boolean {
  return ref.mime.split(";", 1)[0]?.trim().toLowerCase().startsWith("image/") ?? false;
}

function isVideoRef(ref: AttachmentRef): boolean {
  return ref.mime.split(";", 1)[0]?.trim().toLowerCase().startsWith("video/") ?? false;
}

function isPdfRef(ref: AttachmentRef): boolean {
  return ref.mime.split(";", 1)[0]?.trim().toLowerCase() === "application/pdf";
}

function decodeDataUrlText(content: string): string | undefined {
  if (!content.startsWith("data:")) return content;
  const commaIndex = content.indexOf(",");
  if (commaIndex === -1) return undefined;
  const header = content.slice(0, commaIndex);
  const payload = content.slice(commaIndex + 1);
  if (!header.includes(";base64")) return decodeURIComponent(payload);
  try {
    return Buffer.from(payload, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

async function mapAttachmentRef(app: CfApp, ref: AttachmentRef): Promise<TurnAttachment> {
  const displayMeta = displayMetaOf(ref);
  if (!isUriAttachmentRef(ref.ref)) {
    if (isVideoRef(ref)) {
      return { path: ref.ref, type: "video", ...displayMeta };
    }
    return {
      path: ref.ref,
      type: isImageRef(ref) ? "image" : isPdfRef(ref) ? "pdf" : "file",
      ...displayMeta,
    };
  }
  if (ref.sourceKind === "topic-history" || ref.sourceKind === "clipboard-text") {
    return { content: ref.ref, type: "file", ...displayMeta };
  }
  if (isImageRef(ref)) {
    return { content: ref.ref, path: ref.fileName, type: "image", ...displayMeta };
  }
  if (isVideoRef(ref)) {
    return { content: ref.ref, path: ref.fileName, type: "video", ...displayMeta };
  }
  if (isPdfRef(ref)) {
    return { content: ref.ref, path: ref.fileName, type: "pdf", ...displayMeta };
  }
  if (ref.bytes > INLINE_TEXT_ATTACHMENT_MAX_BYTES) {
    return { type: "file", ...displayMeta };
  }
  try {
    const artifact = await app.readToolResultArtifact(ref.ref);
    const text = decodeDataUrlText(artifact.content);
    return text !== undefined
      ? { content: text, path: ref.fileName, type: "file", ...displayMeta }
      : { type: "file", ...displayMeta };
  } catch {
    return { type: "file", ...displayMeta };
  }
}

export async function mapAttachmentRefsToTurnAttachments(
  app: CfApp,
  refs: readonly AttachmentRef[] | undefined,
): Promise<TurnAttachment[] | undefined> {
  if (!refs || refs.length === 0) return undefined;
  const mapped = await Promise.all(refs.map((ref) => mapAttachmentRef(app, ref)));
  return mapped.length > 0 ? mapped : undefined;
}
