import { describe, expect, it, vi } from "vitest";
import {
  buildHighspeedShareNotice,
  copyHighspeedCardImage,
  isHighspeedShareEligible,
  isHighspeedShareNoticePayload,
  resolveHighspeedShareNoticeMetrics,
} from "@/highspeed/highspeedShare.js";

const metrics = { outputTokens: 120_000, durationMs: 600_000, regularTps: 20, highspeedTps: 100 };

describe("highspeed client share", () => {
  it("requires a complete speedup greater than 1.2x before enabling sharing", () => {
    expect(
      isHighspeedShareEligible({
        outputTokens: 100,
        durationMs: 10_000,
        regularTps: 10,
        highspeedTps: 18,
        savedDurationMs: 8_000,
      }),
    ).toBe(true);
    expect(
      isHighspeedShareEligible({
        outputTokens: 100,
        durationMs: 10_000,
        regularTps: 10,
        highspeedTps: 18,
        savedDurationMs: 2_000,
      }),
    ).toBe(false);
    expect(
      isHighspeedShareEligible({
        outputTokens: 100,
        durationMs: 10_000,
        regularTps: 10,
        highspeedTps: 18,
        savedDurationMs: 2_001,
      }),
    ).toBe(true);
  });

  it("rejects missing or invalid share metrics", () => {
    expect(
      isHighspeedShareEligible({
        outputTokens: 0,
        durationMs: 10_000,
        regularTps: 10,
        highspeedTps: 18,
        savedDurationMs: 8_000,
      }),
    ).toBe(false);
    expect(
      isHighspeedShareEligible({
        outputTokens: 100,
        durationMs: 0,
        regularTps: 10,
        highspeedTps: 18,
        savedDurationMs: 8_000,
      }),
    ).toBe(false);
    expect(
      isHighspeedShareEligible({
        outputTokens: 100,
        durationMs: 10_000,
        regularTps: 0,
        highspeedTps: 18,
      }),
    ).toBe(false);
  });

  it("publishes millisecond metrics without a server share id or URL", () => {
    const notice = buildHighspeedShareNotice({ cardId: "hsc_xxx", metrics, now: 100_000 });
    expect(notice.payload).toMatchObject({
      cardId: "hsc_xxx",
      tokenUsage: 120_000,
      durationMs: 600_000,
      savedDurationMs: 1_066_667,
    });
    expect(notice.payload).not.toHaveProperty("durationSeconds");
    expect(notice.payload).not.toHaveProperty("savedDurationSeconds");
    expect(notice.payload).not.toHaveProperty("shareId");
    expect(notice.payload).not.toHaveProperty("shareUrl");
  });

  it("keeps boundary speedups eligible after a publish/render round trip", () => {
    const boundary = {
      outputTokens: 1_000,
      durationMs: 6_100,
      regularTps: 10,
      highspeedTps: 18,
      savedDurationMs: 1_225,
    };
    expect(isHighspeedShareEligible(boundary)).toBe(true);
    const notice = buildHighspeedShareNotice({ cardId: "hsc_edge", metrics: boundary, now: 1 });
    const payload = notice.payload;
    if (!isHighspeedShareNoticePayload(payload)) throw new Error("payload shape changed");
    const rebuilt = resolveHighspeedShareNoticeMetrics(payload);
    expect(rebuilt).toMatchObject({
      outputTokens: 1_000,
      durationMs: 6_100,
      savedDurationMs: 1_225,
    });
    expect(isHighspeedShareEligible(rebuilt)).toBe(true);
  });

  it("reads legacy second-precision payloads by scaling back to milliseconds", () => {
    const rebuilt = resolveHighspeedShareNoticeMetrics({
      cardId: "hsc_legacy",
      tokenUsage: 120_000,
      durationSeconds: 600,
      savedDurationSeconds: 480,
    });
    expect(rebuilt).toMatchObject({
      outputTokens: 120_000,
      durationMs: 600_000,
      savedDurationMs: 480_000,
    });
    expect(isHighspeedShareEligible(rebuilt)).toBe(true);
  });

  it("copies an image blob containing only the metric card", async () => {
    let copied: Blob | undefined;
    await copyHighspeedCardImage(metrics, async (blob) => {
      copied = blob;
    });
    expect(copied?.type).toBe("image/svg+xml");
    expect(await copied?.text()).toContain("120,000 tokens");
    expect(await copied?.text()).not.toContain("Copy image");
  });

  it("uses localized labels when copying the image", async () => {
    let copied: Blob | undefined;
    await copyHighspeedCardImage(
      metrics,
      async (blob) => {
        copied = blob;
      },
      {
        benefit: "CodeFusion 与 Coding Plan 专属Entitlements",
        standardSpeed: "Label准生成速度",
        speedSummary: "HighSpeed · 20 分钟",
        lessWaiting: "减少Waiting 80%",
        imageSummary: "120,000 tokens · 节省 1,067 秒",
      },
    );
    const svg = await copied?.text();
    expect(svg).toContain("Label准生成速度");
    expect(svg).toContain("减少Waiting 80%");
    expect(svg).toContain("节省 1,067 秒");
    expect(svg).not.toContain("standard generation speed");
  });

  it("rasterizes the SVG before writing it to the image clipboard", async () => {
    const originalImage = globalThis.Image;
    const originalDocument = globalThis.document;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const onload = vi.fn();
    let rasterSource: Blob | undefined;
    const canvasContext = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arcTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
    };
    Object.assign(globalThis, {
      Image: class {
        set src(_value: string) {
          onload();
          (this as { onload?: () => void }).onload?.();
        }
        onload?: () => void;
      },
      document: {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => canvasContext,
          toBlob: (callback: (blob: Blob) => void) =>
            callback(new Blob(["png"], { type: "image/png" })),
        }),
      },
    });
    URL.createObjectURL = vi.fn((blob: Blob) => {
      rasterSource = blob;
      return "blob:test";
    });
    URL.revokeObjectURL = vi.fn();
    try {
      let copied: Blob | undefined;
      await copyHighspeedCardImage(metrics, async (blob) => {
        copied = blob;
      });
      expect(copied?.type).toBe("image/png");
      expect(onload).toHaveBeenCalled();
      expect(canvasContext.clip).not.toHaveBeenCalled();
      const rasterSvg = await rasterSource?.text();
      expect(rasterSvg).toContain('width="872" height="608" viewBox="0 0 436 304"');
      expect(rasterSvg).not.toContain('rx="20"');
    } finally {
      Object.assign(globalThis, { Image: originalImage, document: originalDocument });
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});
