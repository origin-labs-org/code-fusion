type AppBadgeSetter = (count: number) => void;

export function parseWindowUnreadCount(payload: unknown): number | null {
  if (typeof payload !== "number" || !Number.isInteger(payload) || payload < 0) {
    return null;
  }

  return payload;
}

export function maxWindowUnreadCounts(windowUnreadCountMap: ReadonlyMap<number, number>): number {
  let maxUnreadCount = 0;

  for (const unreadCount of windowUnreadCountMap.values()) {
    maxUnreadCount = Math.max(maxUnreadCount, unreadCount);
  }

  return maxUnreadCount;
}

export function supportsAppUnreadBadge(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "linux";
}

export function supportsWindowOverlayBadge(platform: NodeJS.Platform): boolean {
  return platform === "win32";
}

export function resolveBadgeOverlayLabel(totalUnreadCount: number): string | null {
  if (!Number.isInteger(totalUnreadCount) || totalUnreadCount <= 0) {
    return null;
  }

  return totalUnreadCount > 9 ? "9+" : String(totalUnreadCount);
}

export function syncUnreadBadgeForPlatform(options: {
  platform: NodeJS.Platform;
  totalUnreadCount: number;
  setBadgeCount: AppBadgeSetter;
  applyOverlay: (label: string | null) => void;
}): void {
  if (supportsAppUnreadBadge(options.platform)) {
    options.setBadgeCount(options.totalUnreadCount);
    return;
  }

  if (supportsWindowOverlayBadge(options.platform)) {
    options.applyOverlay(resolveBadgeOverlayLabel(options.totalUnreadCount));
  }
}

export const TASKBAR_BADGE_IMAGE_SIZE = 32;

const BADGE_CIRCLE_COLOR = { red: 229, green: 57, blue: 53 } as const;
const BADGE_TEXT_COLOR = { red: 255, green: 255, blue: 255 } as const;

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_SCALE = 2;

const BADGE_PADDING = 3;

const BADGE_FONT: Record<string, number[]> = {
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  "3": [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  "+": [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
};

export type BadgePixelOptions = {
  size?: number;
  glyphScale?: number;
  padding?: number;
  
  dot?: boolean;
  
  anchor?: "center" | "bottom-right";
};

export function renderTaskbarBadgePixels(
  label: string,
  options: BadgePixelOptions = {},
): Uint8Array {
  const size = options.size ?? TASKBAR_BADGE_IMAGE_SIZE;
  const glyphScale = options.glyphScale ?? GLYPH_SCALE;
  const padding = options.padding ?? BADGE_PADDING;
  const glyphSpacing = glyphScale;
  const pixels = new Uint8Array(size * size * 4);
  const glyphs = options.dot
    ? []
    : [...label]
        .map((character) => BADGE_FONT[character])
        .filter((glyph): glyph is number[] => Array.isArray(glyph));
  if (glyphs.length === 0 && !options.dot) {
    return pixels;
  }

  const glyphWidth = GLYPH_WIDTH * glyphScale;
  const glyphHeight = GLYPH_HEIGHT * glyphScale;
  const totalWidth = glyphs.length * glyphWidth + (glyphs.length - 1) * glyphSpacing;
  const originX = Math.round((size - totalWidth) / 2);
  const originY = Math.round((size - glyphHeight) / 2);
  const radius = Math.max(1, (size - padding * 2) / 2 - 1);
  const radiusSquared = radius * radius;
  const anchorMargin = 2;
  const center =
    options.anchor === "bottom-right"
      ? { x: size - radius - anchorMargin, y: size - radius - anchorMargin }
      : { x: (size - 1) / 2, y: (size - 1) / 2 };

  const isGlyphPixel = (x: number, y: number): boolean => {
    for (let index = 0; index < glyphs.length; index += 1) {
      const localX = x - originX - index * (glyphWidth + glyphSpacing);
      const localY = y - originY;
      if (localX < 0 || localX >= glyphWidth || localY < 0 || localY >= glyphHeight) {
        continue;
      }

      const glyph = glyphs[index];
      if (!glyph) {
        continue;
      }

      const row = glyph[Math.floor(localY / glyphScale)];
      const column = Math.floor(localX / glyphScale);
      if (row !== undefined && ((row >> (GLYPH_WIDTH - 1 - column)) & 1) === 1) {
        return true;
      }
    }

    return false;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offsetX = x - center.x;
      const offsetY = y - center.y;
      if (offsetX * offsetX + offsetY * offsetY > radiusSquared) {
        continue;
      }

      const color = isGlyphPixel(x, y) ? BADGE_TEXT_COLOR : BADGE_CIRCLE_COLOR;
      const offset = (y * size + x) * 4;
      pixels[offset] = color.blue;
      pixels[offset + 1] = color.green;
      pixels[offset + 2] = color.red;
      pixels[offset + 3] = 255;
    }
  }

  return pixels;
}

export function blendBadgeIntoBitmap(options: {
  base: Uint8Array;
  size: number;
  badge: Uint8Array;
  badgeSize: number;
  originX: number;
  originY: number;
}): void {
  for (let by = 0; by < options.badgeSize; by += 1) {
    const y = options.originY + by;
    if (y < 0 || y >= options.size) {
      continue;
    }

    for (let bx = 0; bx < options.badgeSize; bx += 1) {
      const x = options.originX + bx;
      if (x < 0 || x >= options.size) {
        continue;
      }

      const srcOffset = (by * options.badgeSize + bx) * 4;
      const srcAlpha = options.badge[srcOffset + 3]!;
      if (srcAlpha === 0) {
        continue;
      }

      const dstOffset = (y * options.size + x) * 4;
      if (srcAlpha === 255) {
        options.base[dstOffset] = options.badge[srcOffset]!;
        options.base[dstOffset + 1] = options.badge[srcOffset + 1]!;
        options.base[dstOffset + 2] = options.badge[srcOffset + 2]!;
        options.base[dstOffset + 3] = 255;
        continue;
      }

      const keepRatio = (255 - srcAlpha) / 255;
      for (let channel = 0; channel < 4; channel += 1) {
        const src = options.badge[srcOffset + channel]!;
        const dst = options.base[dstOffset + channel]!;
        options.base[dstOffset + channel] = Math.round(src + dst * keepRatio);
      }
    }
  }
}

export interface AntialiasedDotOptions {
  size: number;
  centerX: number;
  centerY: number;
  radius: number;
  supersample?: number;
}

export function renderAntialiasedStatusDotPixels(
  options: AntialiasedDotOptions,
): Uint8Array {
  const supersample = options.supersample ?? 4;
  const pixels = new Uint8Array(options.size * options.size * 4);
  const samplesPerPixel = supersample * supersample;

  for (let y = 0; y < options.size; y += 1) {
    for (let x = 0; x < options.size; x += 1) {
      let coveredSamples = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const sampleX = x + (sx + 0.5) / supersample;
          const sampleY = y + (sy + 0.5) / supersample;
          const dx = sampleX - options.centerX;
          const dy = sampleY - options.centerY;
          if (dx * dx + dy * dy <= options.radius * options.radius) coveredSamples += 1;
        }
      }

      if (coveredSamples === 0) continue;
      const coverage = coveredSamples / samplesPerPixel;
      const offset = (y * options.size + x) * 4;
      pixels[offset] = Math.round(BADGE_CIRCLE_COLOR.blue * coverage);
      pixels[offset + 1] = Math.round(BADGE_CIRCLE_COLOR.green * coverage);
      pixels[offset + 2] = Math.round(BADGE_CIRCLE_COLOR.red * coverage);
      pixels[offset + 3] = Math.round(coverage * 255);
    }
  }

  return pixels;
}

export type TaskbarOverlayLayout = "windows-10" | "windows-11";

export function renderTaskbarStatusDotPixels(
  scale: 1 | 2 = 1,
  layout: TaskbarOverlayLayout = "windows-11",
): Uint8Array {
  const center = layout === "windows-10" ? 11.25 : 8;
  return renderAntialiasedStatusDotPixels({
    size: 16 * scale,
    centerX: center * scale,
    centerY: center * scale,
    radius: 3.5 * scale,
  });
}

export type TaskbarOverlayWindow = {
  isDestroyed(): boolean;
  setOverlayIcon(overlay: unknown, description: string): void;
};

export function applyTaskbarOverlayToWindows(options: {
  label: string | null;
  windows: Iterable<TaskbarOverlayWindow>;
  badgeImageForLabel: (label: string) => unknown;
}): void {
  const image = options.label ? options.badgeImageForLabel(options.label) : null;
  const description = options.label ? `${options.label} unread tasks` : "";

  for (const win of options.windows) {
    if (win.isDestroyed()) {
      continue;
    }

    win.setOverlayIcon(image, description);
  }
}

export function createWindowsTaskbarOverlayApplier(deps: {
  getAllWindows: () => Iterable<TaskbarOverlayWindow>;
  createBadgeImage: (label: string) => unknown;
}): (label: string | null) => void {
  const badgeImageCache = new Map<string, unknown>();

  return (label) => {
    applyTaskbarOverlayToWindows({
      label,
      windows: deps.getAllWindows(),
      badgeImageForLabel: (cachedLabel) => {
        const cachedImage = badgeImageCache.get(cachedLabel);
        if (cachedImage) {
          return cachedImage;
        }

        const image = deps.createBadgeImage(cachedLabel);
        badgeImageCache.set(cachedLabel, image);
        return image;
      },
    });
  };
}
