import { describe, expect, it, vi } from "vitest";
import { VIDEO_INPUT_MAX_BYTES } from "@origin-ai/cf-shared";
import { PROTOCOL_V4_LIMITS } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  MissingInlineImageContentError,
  OversizedInlineImageAttachmentError,
  OversizedInlinePdfAttachmentError,
  OversizedInlineVideoAttachmentError,
  countClipboardTextLines,
  createClipboardTextComposerAttachment,
  createClipboardTextPathComposerAttachment,
  createChatComposerAttachment,
  createChatComposerPathAttachment,
  restoreChatComposerAttachment,
  serializeChatComposerAttachment,
  shouldCreateClipboardTextAttachment,
  shouldPreferSpreadsheetClipboardText,
} from "../src/lib/chatAttachments.js";

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(file: File) {
    void file.arrayBuffer().then(
      (buffer) => {
        const bytes = Buffer.from(buffer);
        this.result = `data:${file.type};base64,${bytes.toString("base64")}`;
        this.onload?.();
      },
      (error: unknown) => {
        this.error = error instanceof Error ? error : new Error(String(error));
        this.onerror?.();
      },
    );
  }
}

vi.stubGlobal("FileReader", TestFileReader);

const OVERSIZED_INLINE_IMAGE_BASE64 = "A".repeat(Math.ceil(((20 * 1024 * 1024 + 1) * 4) / 3));
const OVERSIZED_INLINE_VIDEO_BASE64 = "A".repeat(Math.ceil(((VIDEO_INPUT_MAX_BYTES + 1) * 4) / 3));
const OVERSIZED_INLINE_PDF_BASE64 = "A".repeat(
  Math.ceil(((PROTOCOL_V4_LIMITS.attachmentMaxBytes + 1) * 4) / 3),
);

describe("serializeChatComposerAttachment", () => {
  it("keeps deferred text source metadata in Web file serialization", async () => {
    const file = createClipboardTextComposerAttachment("original text");
    expect(
      await serializeChatComposerAttachment({
        ...file,
        sourceKind: "topic-history",
        messageCount: 2,
      }),
    ).toMatchObject({ sourceKind: "topic-history", messageCount: 2, textContent: "original text" });
  });
  it("Text files are serialized as standard file attachments while preserving readable content", async () => {
    const file = new File(["hello cf"], "notes.txt", {
      type: "text/plain",
    });

    const attachment = await serializeChatComposerAttachment(createChatComposerAttachment(file));

    expect(attachment).toMatchObject({
      kind: "file",
      filename: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: file.size,
      textContent: "hello cf",
    });
    expect(attachment.dataBase64).toBeUndefined();
  });

  it("Local PDF paths only serialize the path while preserving PDF attachment kind", async () => {
    const attachment = await serializeChatComposerAttachment(
      createChatComposerPathAttachment("/tmp/report.pdf"),
    );

    expect(attachment).toEqual({
      kind: "pdf",
      filename: "report.pdf",
      localPath: "/tmp/report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 0,
    });
  });

  it("无路径 PDF 使用 dataBase64 序列化，并可从草稿恢复", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const file = new File([bytes], "report.pdf", { type: "application/pdf; charset=binary" });
    const serialized = await serializeChatComposerAttachment(createChatComposerAttachment(file));

    expect(serialized).toEqual({
      kind: "pdf",
      filename: "report.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.from(bytes).toString("base64"),
      sizeBytes: bytes.byteLength,
    });
    expect(restoreChatComposerAttachment(serialized)).toMatchObject({
      filename: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes.byteLength,
    });
  });

  it("Web PDF 超过 V4 上限时在 base64 编码前抛结构化错误", async () => {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "large.pdf", {
      type: "application/pdf",
    });
    const attachment = createChatComposerAttachment(file);
    Object.defineProperty(attachment, "sizeBytes", {
      value: PROTOCOL_V4_LIMITS.attachmentMaxBytes + 1,
    });
    const readAsDataUrl = vi.spyOn(TestFileReader.prototype, "readAsDataURL");

    try {
      await expect(serializeChatComposerAttachment(attachment)).rejects.toMatchObject({
        filename: "large.pdf",
        maxSizeBytes: PROTOCOL_V4_LIMITS.attachmentMaxBytes,
        name: "OversizedInlinePdfAttachmentError",
      });
      expect(readAsDataUrl).not.toHaveBeenCalled();
    } finally {
      readAsDataUrl.mockRestore();
    }
  });

  it("Dragged standard files with local paths only serialize path references", async () => {
    const file = new File(["hello cf"], "notes.txt", {
      type: "text/plain",
    });

    const attachment = await serializeChatComposerAttachment(
      createChatComposerAttachment(file, "/tmp/notes.txt"),
    );

    expect(attachment).toEqual({
      kind: "file",
      filename: "notes.txt",
      localPath: "/tmp/notes.txt",
      mimeType: "text/plain",
      sizeBytes: file.size,
    });
  });

  it("图片仍保持 CodeFusion Agent image 附件格式", async () => {
    const file = new File(["png-bytes"], "image.png", {
      type: "image/png",
    });

    await expect(
      serializeChatComposerAttachment({
        ...createChatComposerAttachment(file),
        id: "attachment-2",
      }),
    ).resolves.toEqual({
      kind: "image",
      filename: "image.png",
      mimeType: "image/png",
      dataBase64: "cG5nLWJ5dGVz",
      sizeBytes: file.size,
    });
  });

  it("Large images without local paths are intercepted before sending to avoid oversized base64 payloads", async () => {
    const file = new File(["png-bytes"], "large.png", {
      type: "image/png",
    });

    await expect(
      serializeChatComposerAttachment({
        ...createChatComposerAttachment(file),
        sizeBytes: 21 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      filename: "large.png",
      maxSizeBytes: 20 * 1024 * 1024,
      name: "OversizedInlineImageAttachmentError",
      sizeBytes: 21 * 1024 * 1024,
    });
    await expect(
      serializeChatComposerAttachment({
        ...createChatComposerAttachment(file),
        sizeBytes: 21 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(OversizedInlineImageAttachmentError);
  });

  it("带本地路径的大图片只序列化路径引用", async () => {
    const file = new File(["png-bytes"], "large.png", {
      type: "image/png",
    });

    await expect(
      serializeChatComposerAttachment({
        ...createChatComposerAttachment(file, "/tmp/large.png"),
        sizeBytes: 21 * 1024 * 1024,
      }),
    ).resolves.toEqual({
      kind: "image",
      filename: "large.png",
      localPath: "/tmp/large.png",
      mimeType: "image/png",
      sizeBytes: 21 * 1024 * 1024,
    });
  });

  it("Restoring large images without local paths intercepts them before base64 decoding", () => {
    expect(() =>
      restoreChatComposerAttachment({
        dataBase64: "A",
        filename: "large.png",
        kind: "image",
        mimeType: "image/png",
        sizeBytes: 21 * 1024 * 1024,
      }),
    ).toThrow(OversizedInlineImageAttachmentError);
  });

  it("Restoring oversized PDFs without local paths intercepts them before base64 decoding", () => {
    expect(() =>
      restoreChatComposerAttachment({
        dataBase64: OVERSIZED_INLINE_PDF_BASE64,
        filename: "large.pdf",
        kind: "pdf",
        mimeType: "application/pdf",
      }),
    ).toThrow(OversizedInlinePdfAttachmentError);
  });

  it("Restoring oversized base64 images missing sizeBytes intercepts them before decoding", () => {
    expect(() =>
      restoreChatComposerAttachment({
        dataBase64: OVERSIZED_INLINE_IMAGE_BASE64,
        filename: "legacy-large.png",
        kind: "image",
        mimeType: "image/png",
      }),
    ).toThrow(OversizedInlineImageAttachmentError);
  });

  it("Restoring images with underreported sizeBytes but oversized base64 intercepts them based on actual length", () => {
    expect(() =>
      restoreChatComposerAttachment({
        dataBase64: OVERSIZED_INLINE_IMAGE_BASE64,
        filename: "mismatched-large.png",
        kind: "image",
        mimeType: "image/png",
        sizeBytes: 1,
      }),
    ).toThrow(OversizedInlineImageAttachmentError);
  });

  it("Restoring images with local paths and oversized base64 skips decoding and preserves the path reference", () => {
    const atobSpy = vi.spyOn(globalThis, "atob");

    try {
      expect(
        restoreChatComposerAttachment({
          dataBase64: OVERSIZED_INLINE_IMAGE_BASE64,
          filename: "path-large.png",
          kind: "image",
          localPath: "/tmp/path-large.png",
          mimeType: "image/png",
          sizeBytes: 1,
        }),
      ).toMatchObject({
        filename: "path-large.png",
        localPath: "/tmp/path-large.png",
        mimeType: "image/png",
        sizeBytes: 20 * 1024 * 1024 + 1,
      });
      expect(atobSpy).not.toHaveBeenCalled();
    } finally {
      atobSpy.mockRestore();
    }
  });

  it("Restoring small images without local paths or base64 results in a structured rejection", () => {
    expect(() =>
      restoreChatComposerAttachment({
        filename: "metadata-only.png",
        kind: "image",
        mimeType: "image/png",
        sizeBytes: 1,
      }),
    ).toThrow(MissingInlineImageContentError);
  });

  it("Restoring oversized images without local paths or base64 preserves pre-send interception state", () => {
    expect(
      restoreChatComposerAttachment({
        filename: "metadata-only-large.png",
        kind: "image",
        mimeType: "image/png",
        sizeBytes: 21 * 1024 * 1024,
      }),
    ).toMatchObject({
      filename: "metadata-only-large.png",
      mimeType: "image/png",
      sizeBytes: 21 * 1024 * 1024,
    });
  });
});

describe("clipboard text attachments", () => {
  it("Excel HTML or tab-delimited text takes precedence over synthetic images from the same payload", () => {
    expect(shouldPreferSpreadsheetClipboardText("A\tB\n1\t2", "")).toBe(true);
    expect(
      shouldPreferSpreadsheetClipboardText(
        "单个单元格",
        '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><meta name=ProgId content=Excel.Sheet>',
      ),
    ).toBe(true);
    expect(
      shouldPreferSpreadsheetClipboardText("Numbers 单元格", "<table><tr><td>x</td></tr></table>"),
    ).toBe(true);
    expect(shouldPreferSpreadsheetClipboardText("https://example.com/image.png", "<img>")).toBe(
      false,
    );
    expect(shouldPreferSpreadsheetClipboardText("", "Excel.Sheet")).toBe(false);
  });

  it("Converts clipboard text to an attachment when it reaches 15,360 characters or more", () => {
    expect(shouldCreateClipboardTextAttachment("a".repeat(15_359))).toBe(false);
    expect(shouldCreateClipboardTextAttachment("a".repeat(15_360))).toBe(true);
  });

  it("转附件不再依赖行数", () => {
    const manyShortLines = Array.from({ length: 100 }, () => "x").join("\n");
    const singleLongLine = "x".repeat(15_360);

    expect(countClipboardTextLines(manyShortLines)).toBe(100);
    expect(shouldCreateClipboardTextAttachment(manyShortLines)).toBe(false);
    expect(countClipboardTextLines(singleLongLine)).toBe(1);
    expect(shouldCreateClipboardTextAttachment(singleLongLine)).toBe(true);
  });

  it("Compatible with CRLF and CR newline counting", () => {
    expect(countClipboardTextLines("a\r\nb\rc\nd")).toBe(4);
  });

  it("Creates a text attachment with clipboard-text metadata", async () => {
    const text = Array.from({ length: 15 }, (_, index) => `line ${index + 1}`).join("\n");

    const attachment = createClipboardTextComposerAttachment(text, {
      now: new Date("2026-06-27T15:30:12"),
    });

    expect(attachment).toMatchObject({
      filename: "pasted-text-20260627-153012.txt",
      mimeType: "text/plain",
      sourceKind: "clipboard-text",
      lineCount: 15,
      charCount: text.length,
    });
    await expect(attachment.file?.text()).resolves.toBe(text);
  });

  it("落盘后的粘贴文本附件只序列化 localPath，不内联 textContent", async () => {
    const text = "x".repeat(15_360);
    const attachment = await serializeChatComposerAttachment(
      createClipboardTextPathComposerAttachment(text, {
        filename: "pasted-text-20260630-104512-a1b2c3.txt",
        localPath: "/Users/test/.cf/tmp/paste-attachments/2026-06-30/pasted-text.txt",
        mimeType: "text/plain",
        sizeBytes: Buffer.byteLength(text, "utf8"),
      }),
    );

    expect(attachment).toEqual({
      kind: "file",
      filename: "pasted-text-20260630-104512-a1b2c3.txt",
      localPath: "/Users/test/.cf/tmp/paste-attachments/2026-06-30/pasted-text.txt",
      mimeType: "text/plain",
      sourceKind: "clipboard-text",
      sizeBytes: 15_360,
    });
  });
});

describe("video attachments", () => {
  it("Videos without localPath serialize as kind video via dataBase64", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "demo.mp4", {
      type: "video/mp4",
    });

    const attachment = await serializeChatComposerAttachment(createChatComposerAttachment(file));

    expect(attachment).toMatchObject({
      kind: "video",
      filename: "demo.mp4",
      mimeType: "video/mp4",
      sizeBytes: file.size,
    });
    expect(attachment.dataBase64).toEqual(Buffer.from([1, 2, 3, 4]).toString("base64"));
  });

  it("有 localPath 的视频只序列化路径引用（零拷贝）", async () => {
    const file = new File([new Uint8Array([9, 9])], "clip.mov", {
      type: "video/quicktime",
    });

    const attachment = await serializeChatComposerAttachment(
      createChatComposerAttachment(file, "/tmp/clip.mov"),
    );

    expect(attachment).toEqual({
      kind: "video",
      filename: "clip.mov",
      localPath: "/tmp/clip.mov",
      mimeType: "video/quicktime",
      sizeBytes: file.size,
    });
  });

  it("Throws a structured error before base64 encoding when a pathless Web video exceeds the V4 limit", async () => {
    const file = new File([new Uint8Array(4)], "big.mp4", { type: "video/mp4" });
    const attachment = createChatComposerAttachment(file);
    Object.defineProperty(attachment, "sizeBytes", {
      value: PROTOCOL_V4_LIMITS.attachmentMaxBytes + 1,
    });
    const readAsDataUrl = vi.spyOn(TestFileReader.prototype, "readAsDataURL");

    try {
      await expect(serializeChatComposerAttachment(attachment)).rejects.toMatchObject({
        filename: "big.mp4",
        maxSizeBytes: PROTOCOL_V4_LIMITS.attachmentMaxBytes,
        name: "OversizedInlineVideoAttachmentError",
        sizeBytes: PROTOCOL_V4_LIMITS.attachmentMaxBytes + 1,
      });
      expect(readAsDataUrl).not.toHaveBeenCalled();
    } finally {
      readAsDataUrl.mockRestore();
    }
  });

  it("restore recovers video dataBase64 attachments and generates previewable objectUrls", () => {
    const attachment = restoreChatComposerAttachment({
      kind: "video",
      filename: "demo.mp4",
      mimeType: "video/mp4",
      dataBase64: Buffer.from([5, 6, 7]).toString("base64"),
      sizeBytes: 3,
    });

    expect(attachment.mimeType).toBe("video/mp4");
    expect(attachment.sizeBytes).toBeGreaterThanOrEqual(3);
    expect(attachment.objectUrl).toBeDefined();
  });

  it.each([
    ["缺少", undefined],
    ["Underreported", 1],
  ])("restore intercepts oversized videos with sizeBytes %s before decoding", (_label, sizeBytes) => {
    const atobSpy = vi.spyOn(globalThis, "atob");

    try {
      expect(() =>
        restoreChatComposerAttachment({
          kind: "video",
          filename: "oversized.mp4",
          mimeType: "video/mp4",
          dataBase64: OVERSIZED_INLINE_VIDEO_BASE64,
          ...(sizeBytes === undefined ? {} : { sizeBytes }),
        }),
      ).toThrow(OversizedInlineVideoAttachmentError);
      expect(atobSpy).not.toHaveBeenCalled();
    } finally {
      atobSpy.mockRestore();
    }
  });

  it("Video extension is inferred from filename when browser mime is unavailable", () => {
    const attachment = createChatComposerAttachment(
      new File([new Uint8Array(1)], "a.MOV", { type: "" }),
    );
    expect(attachment.mimeType).toBe("video/quicktime");
  });
});
