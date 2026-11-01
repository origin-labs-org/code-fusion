import { describe, expect, it } from "vitest";
import {
  HIGHSPEED_MODEL_SWITCH_START_PROGRESS,
  parseHighSpeedCanvasColor,
  resolveHighSpeedCanvasColor,
  resolveHighSpeedDiffusionDistance,
  resolveHighSpeedDiffusionProgress,
  shouldCompleteHighSpeedDiffusion,
  shouldStartHighSpeedModelSwitch,
} from "@/v4/highspeed/highSpeedDiffusion.js";

function createFakeCanvasContext(): Pick<CanvasRenderingContext2D, "fillStyle"> {
  const named: Record<string, string> = { black: "#000000", white: "#ffffff" };
  let current = "#000000";
  return {
    get fillStyle() {
      return current;
    },
    set fillStyle(value) {
      if (typeof value !== "string") return;
      const color = value.trim().toLowerCase();
      const short = color.match(/^#([\da-f])([\da-f])([\da-f])$/);
      if (named[color]) current = named[color];
      else if (short)
        current = `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
      else if (/^#[\da-f]{6}$/.test(color)) current = color;
    },
  };
}

describe("Highspeed activation visual", () => {
  it("扩散画布能解析生产压缩后的颜色 token，浅色马赛克底色不回退深色", () => {
    expect(parseHighSpeedCanvasColor("#fff")).toEqual([255, 255, 255]);
    expect(parseHighSpeedCanvasColor("#ffffff")).toEqual([255, 255, 255]);
    expect(parseHighSpeedCanvasColor("#151515")).toEqual([21, 21, 21]);
    expect(parseHighSpeedCanvasColor("#9E77ED")).toEqual([158, 119, 237]);
    expect(parseHighSpeedCanvasColor("#7453b0c2")).toEqual([116, 83, 176]);
    expect(parseHighSpeedCanvasColor("rgba(116, 83, 176, 0.76)")).toEqual([116, 83, 176]);
    expect(parseHighSpeedCanvasColor("")).toBeNull();
    expect(parseHighSpeedCanvasColor("oklch(0.99 0 0)")).toBeNull();
  });

  it("Canvas color tokens that fail to parse fall back to default color instead of reusing previous fillStyle", () => {
    const context = createFakeCanvasContext();
    const fallback = [21, 21, 21] as const;

    expect(resolveHighSpeedCanvasColor(context, "#fff", fallback)).toEqual([255, 255, 255]);
    expect(resolveHighSpeedCanvasColor(context, "white", fallback)).toEqual([255, 255, 255]);
    expect(resolveHighSpeedCanvasColor(context, "var(--color-input)", fallback)).toEqual(fallback);
    expect(resolveHighSpeedCanvasColor(context, "  ", fallback)).toEqual(fallback);
    expect(resolveHighSpeedCanvasColor(context, "#000000", fallback)).toEqual([0, 0, 0]);
    expect(resolveHighSpeedCanvasColor(context, "#ffffff", fallback)).toEqual([255, 255, 255]);
  });

  it("uses a responsive center-out diffusion timeline", () => {
    expect(resolveHighSpeedDiffusionProgress(700)).toBe(0.5);
    expect(resolveHighSpeedDiffusionProgress(1_500)).toBe(1);
    expect(shouldStartHighSpeedModelSwitch(HIGHSPEED_MODEL_SWITCH_START_PROGRESS)).toBe(true);
    expect(shouldCompleteHighSpeedDiffusion(0.84)).toBe(true);

    expect(resolveHighSpeedDiffusionDistance({ x: 350, y: 52, width: 700, height: 104 })).toBe(0);
    expect(
      resolveHighSpeedDiffusionDistance({ x: 700, y: 52, width: 700, height: 104 }),
    ).toBeCloseTo(1, 4);
  });
});
