
import { nanoid } from "nanoid";
import {
  VIDEO_INPUT_MAX_BYTES,
  type CreateTempTextAttachmentResult,
  type CfPromptAttachment,
} from "@origin-ai/cf-shared";
import { PROTOCOL_V4_LIMITS } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  MissingInlineImageContentError,
  MissingInlinePdfContentError,
  OversizedInlineImageAttachmentError,
  OversizedInlinePdfAttachmentError,
  OversizedInlineVideoAttachmentError,
} from "@/lib/chatAttachmentErrors.js";
import {
  basenameFromPath,
  countClipboardTextLines,
  createClipboardTextAttachmentFilename,
  inferAttachmentMimeType,
  isTextLikeAttachment,
} from "@/lib/chatAttachmentMetadata.js";

export {
  MissingInlineImageContentError,
  MissingInlinePdfContentError,
  OversizedInlineImageAttachmentError,
  OversizedInlinePdfAttachmentError,
  OversizedInlineVideoAttachmentError,
} from "@/lib/chatAttachmentErrors.js";
export {
  countClipboardTextLines,
  formatAttachmentSize,
  shouldPreferSpreadsheetClipboardText,
} from "@/lib/chatAttachmentMetadata.js";

export const MAX_CHAT_ATTACHMENTS = 8;
export const LONG_PASTE_TEXT_ATTACHMENT_CHAR_THRESHOLD = 15 * 1024;
const INLINE_IMAGE_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const INLINE_VIDEO_ATTACHMENT_MAX_BYTES = Math.min(
  VIDEO_INPUT_MAX_BYTES,
  PROTOCOL_V4_LIMITS.attachmentMaxBytes,
);
const INLINE_TEXT_ATTACHMENT_MAX_CHARS = 64 * 1024;

export type ChatComposerAttachmentSourceKind = "clipboard-text" | "topic-history";

export interface ChatComposerAttachment {
  id: string;
  file?: File;
  filename: string;
  sourceKind?: ChatComposerAttachmentSourceKind;
  messageCount?: number;
  lineCount?: number;
  charCount?: number;
  mimeType: string;
  sizeBytes: number;
  objectUrl?: string;
  localPath?: string;
}

const PDF_MIME_TYPE = "application/pdf";

function normalizeComposerMimeType(mimeType: string): string {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized === PDF_MIME_TYPE ? PDF_MIME_TYPE : mimeType;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("读取附件失败"));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("读取附件失败"));
    };
    reader.readAsDataURL(file);
  });
}

export function createChatComposerAttachment(
  file: File,
  localPath?: string,
): ChatComposerAttachment {
  const mimeType = normalizeComposerMimeType(file.type || inferAttachmentMimeType(file.name));
  return {
    id: nanoid(),
    file,
    filename: file.name,
    localPath,
    mimeType,
    objectUrl: URL.createObjectURL(file),
    sizeBytes: file.size,
  };
}

export function createChatComposerPathAttachment(localPath: string): ChatComposerAttachment {
  const filename = basenameFromPath(localPath);
  return {
    id: nanoid(),
    filename,
    localPath,
    mimeType: inferAttachmentMimeType(filename),
    sizeBytes: 0,
  };
}

export function createClipboardTextComposerAttachment(
  text: string,
  options: { now?: Date } = {},
): ChatComposerAttachment {
  const filename = createClipboardTextAttachmentFilename(options.now ?? new Date());
  const file = new File([text], filename, { type: "text/plain" });
  return {
    ...createChatComposerAttachment(file),
    charCount: text.length,
    lineCount: countClipboardTextLines(text),
    sourceKind: "clipboard-text",
  };
}

export function createClipboardTextPathComposerAttachment(
  text: string,
  attachment: CreateTempTextAttachmentResult,
): ChatComposerAttachment {
  return {
    id: nanoid(),
    filename: attachment.filename,
    localPath: attachment.localPath,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    charCount: text.length,
    lineCount: countClipboardTextLines(text),
    sourceKind: "clipboard-text",
  };
}

export function shouldCreateClipboardTextAttachment(text: string): boolean {
  return text.length >= LONG_PASTE_TEXT_ATTACHMENT_CHAR_THRESHOLD;
}

export function createClipboardTextAttachmentFilenameForDate(now: Date = new Date()): string {
  return createClipboardTextAttachmentFilename(now);
}

function decodeBase64ToBytes(dataBase64: string) {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function estimateDecodedBase64Bytes(dataBase64: string) {
  const paddingBytes = dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((dataBase64.length * 3) / 4) - paddingBytes);
}

export function restoreChatComposerAttachment(
  attachment: CfPromptAttachment,
): ChatComposerAttachment {
  const mimeType = normalizeComposerMimeType(
    attachment.mimeType || inferAttachmentMimeType(attachment.filename),
  );
  const sizeBytes = "sizeBytes" in attachment ? (attachment.sizeBytes ?? 0) : 0;

  if (attachment.localPath && !attachment.dataBase64) {
    return {
      id: nanoid(),
      filename: attachment.filename,
      localPath: attachment.localPath,
      mimeType,
      ...("sourceKind" in attachment &&
      (attachment.sourceKind === "clipboard-text" || attachment.sourceKind === "topic-history")
        ? { sourceKind: attachment.sourceKind, messageCount: attachment.messageCount }
        : {}),
      sizeBytes,
    };
  }

  if (!attachment.dataBase64) {
    if (mimeType.startsWith("image/")) {
      if (!attachment.localPath && sizeBytes <= INLINE_IMAGE_ATTACHMENT_MAX_BYTES) {
        throw new MissingInlineImageContentError({
          filename: attachment.filename,
          sizeBytes,
        });
      }
      return {
        id: nanoid(),
        filename: attachment.filename,
        localPath: attachment.localPath,
        mimeType,
        sizeBytes,
      };
    }
    if (mimeType.split(";", 1)[0]?.trim().toLowerCase() === PDF_MIME_TYPE) {
      if (!attachment.localPath) {
        throw new MissingInlinePdfContentError({
          filename: attachment.filename,
          sizeBytes,
        });
      }
      return {
        id: nanoid(),
        filename: attachment.filename,
        localPath: attachment.localPath,
        mimeType,
        sizeBytes,
      };
    }
    const file = new File(
      [attachment.kind === "file" ? (attachment.textContent ?? "") : ""],
      attachment.filename,
      {
        type: mimeType,
      },
    );
    return createChatComposerAttachment(file, attachment.localPath);
  }

  const hasImageBase64 = mimeType.startsWith("image/") && Boolean(attachment.dataBase64);
  const hasVideoBase64 = mimeType.startsWith("video/") && Boolean(attachment.dataBase64);
  const hasPdfBase64 = mimeType.split(";", 1)[0]?.trim().toLowerCase() === PDF_MIME_TYPE;
  const estimatedSizeBytes =
    hasImageBase64 || hasVideoBase64 || hasPdfBase64
      ? estimateDecodedBase64Bytes(attachment.dataBase64)
      : sizeBytes;
  const effectiveSizeBytes = Math.max(sizeBytes, estimatedSizeBytes);

  if (hasImageBase64 && effectiveSizeBytes > INLINE_IMAGE_ATTACHMENT_MAX_BYTES) {
    if (attachment.localPath) {
      return {
        id: nanoid(),
        filename: attachment.filename,
        localPath: attachment.localPath,
        mimeType,
        sizeBytes: effectiveSizeBytes,
      };
    }
    throw new OversizedInlineImageAttachmentError({
      filename: attachment.filename,
      maxSizeBytes: INLINE_IMAGE_ATTACHMENT_MAX_BYTES,
      sizeBytes: effectiveSizeBytes,
    });
  }

  if (hasVideoBase64 && effectiveSizeBytes > VIDEO_INPUT_MAX_BYTES) {
    if (attachment.localPath) {
      return {
        id: nanoid(),
        filename: attachment.filename,
        localPath: attachment.localPath,
        mimeType,
        sizeBytes: effectiveSizeBytes,
      };
    }
    throw new OversizedInlineVideoAttachmentError({
      filename: attachment.filename,
      maxSizeBytes: VIDEO_INPUT_MAX_BYTES,
      sizeBytes: effectiveSizeBytes,
    });
  }

  if (hasPdfBase64 && effectiveSizeBytes > PROTOCOL_V4_LIMITS.attachmentMaxBytes) {
    if (attachment.localPath) {
      return {
        id: nanoid(),
        filename: attachment.filename,
        localPath: attachment.localPath,
        mimeType,
        sizeBytes: effectiveSizeBytes,
      };
    }
    throw new OversizedInlinePdfAttachmentError({
      filename: attachment.filename,
      maxSizeBytes: PROTOCOL_V4_LIMITS.attachmentMaxBytes,
      sizeBytes: effectiveSizeBytes,
    });
  }

  const bytes = decodeBase64ToBytes(attachment.dataBase64);
  const file = new File([bytes], attachment.filename, {
    type: mimeType,
  });
  return createChatComposerAttachment(file, attachment.localPath);
}

export function revokeChatComposerAttachment(attachment: ChatComposerAttachment) {
  if (attachment.objectUrl) {
    URL.revokeObjectURL(attachment.objectUrl);
  }
}

export async function serializeChatComposerAttachment(
  attachment: ChatComposerAttachment,
): Promise<CfPromptAttachment> {
  const mimeType = normalizeComposerMimeType(
    attachment.mimeType || inferAttachmentMimeType(attachment.filename),
  );
  if (mimeType.startsWith("image/")) {
    if (!attachment.localPath && attachment.sizeBytes > INLINE_IMAGE_ATTACHMENT_MAX_BYTES) {
      throw new OversizedInlineImageAttachmentError({
        filename: attachment.filename,
        maxSizeBytes: INLINE_IMAGE_ATTACHMENT_MAX_BYTES,
        sizeBytes: attachment.sizeBytes,
      });
    }

    if (
      attachment.localPath &&
      (!attachment.file || attachment.sizeBytes > INLINE_IMAGE_ATTACHMENT_MAX_BYTES)
    ) {
      return {
        kind: "image",
        filename: attachment.filename,
        localPath: attachment.localPath,
        mimeType,
        sizeBytes: attachment.sizeBytes,
      };
    }

    const dataBase64 = await readAttachmentBase64(attachment);
    return {
      kind: "image",
      filename: attachment.filename,
      mimeType,
      dataBase64,
      ...(attachment.localPath ? { localPath: attachment.localPath } : {}),
      sizeBytes: attachment.sizeBytes,
    };
  }

  if (mimeType.startsWith("video/")) {
    if (attachment.localPath) {
      return {
        kind: "video",
        filename: attachment.filename,
        localPath: attachment.localPath,
        mimeType,
        sizeBytes: attachment.sizeBytes,
      };
    }
    if (attachment.sizeBytes > INLINE_VIDEO_ATTACHMENT_MAX_BYTES) {
      throw new OversizedInlineVideoAttachmentError({
        filename: attachment.filename,
        maxSizeBytes: INLINE_VIDEO_ATTACHMENT_MAX_BYTES,
        sizeBytes: attachment.sizeBytes,
      });
    }
    const dataBase64 = await readAttachmentBase64(attachment);
    return {
      kind: "video",
      filename: attachment.filename,
      mimeType,
      dataBase64,
      sizeBytes: attachment.sizeBytes,
    };
  }

  if (mimeType.split(";", 1)[0]?.trim().toLowerCase() === PDF_MIME_TYPE) {
    if (attachment.localPath) {
      return {
        kind: "pdf",
        filename: attachment.filename,
        localPath: attachment.localPath,
        mimeType,
        sizeBytes: attachment.sizeBytes,
      };
    }
    if (attachment.sizeBytes > PROTOCOL_V4_LIMITS.attachmentMaxBytes) {
      throw new OversizedInlinePdfAttachmentError({
        filename: attachment.filename,
        maxSizeBytes: PROTOCOL_V4_LIMITS.attachmentMaxBytes,
        sizeBytes: attachment.sizeBytes,
      });
    }
    const dataBase64 = await readAttachmentBase64(attachment);
    return {
      kind: "pdf",
      filename: attachment.filename,
      mimeType,
      dataBase64,
      sizeBytes: attachment.sizeBytes,
    };
  }

  if (attachment.localPath) {
    return {
      kind: "file",
      filename: attachment.filename,
      localPath: attachment.localPath,
      mimeType,
      ...(attachment.sourceKind
        ? { sourceKind: attachment.sourceKind, messageCount: attachment.messageCount }
        : {}),
      sizeBytes: attachment.sizeBytes,
    };
  }

  const textContent =
    attachment.file && isTextLikeAttachment(attachment)
      ? await readAttachmentText(attachment.file)
      : undefined;
  return {
    kind: "file",
    filename: attachment.filename,
    mimeType,
    sizeBytes: attachment.sizeBytes,
    ...(textContent !== undefined ? { textContent } : {}),
    ...(attachment.sourceKind
      ? { sourceKind: attachment.sourceKind, messageCount: attachment.messageCount }
      : {}),
  };
}

async function readAttachmentBase64(attachment: ChatComposerAttachment): Promise<string> {
  if (!attachment.file) {
    throw new Error("Attachment lacks readable content");
  }
  const dataUrl = await readFileAsDataUrl(attachment.file);
  const base64MarkerIndex = dataUrl.indexOf(",");
  if (base64MarkerIndex === -1) {
    throw new Error("附件数据格式不正确");
  }
  return dataUrl.slice(base64MarkerIndex + 1);
}

export function getChatAttachmentPreviewUrl(attachment: CfPromptAttachment): string | null {
  if (!attachment.dataBase64) {
    return null;
  }
  return `data:${attachment.mimeType};base64,${attachment.dataBase64}`;
}

export function isImageChatComposerAttachment(attachment: ChatComposerAttachment): boolean {
  return attachment.mimeType.startsWith("image/");
}

export function isVideoChatComposerAttachment(attachment: ChatComposerAttachment): boolean {
  return attachment.mimeType.startsWith("video/");
}

export function isPdfChatComposerAttachment(attachment: ChatComposerAttachment): boolean {
  return attachment.mimeType.split(";", 1)[0]?.trim().toLowerCase() === PDF_MIME_TYPE;
}

export function isMediaChatComposerAttachment(attachment: ChatComposerAttachment): boolean {
  return isImageChatComposerAttachment(attachment) || isVideoChatComposerAttachment(attachment);
}

async function readAttachmentText(file: File): Promise<string> {
  const text = await file.text();
  return text.length > INLINE_TEXT_ATTACHMENT_MAX_CHARS
    ? `${text.slice(0, INLINE_TEXT_ATTACHMENT_MAX_CHARS)}\n\n[inner容过Long，已截断]`
    : text;
}
