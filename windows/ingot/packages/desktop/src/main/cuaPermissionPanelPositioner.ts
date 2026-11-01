

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface ResolvePanelBoundsInput {
  
  settings: Rect | null;
  
  display: Rect;
  panel: PanelSize;
}

const ANCHOR_OVERLAP_PX = 6;

const SCREEN_BOTTOM_INSET_PX = 28;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function isUsableRect(rect: Rect | null): rect is Rect {
  return rect !== null && rect.width > 0 && rect.height > 0;
}

export function resolvePanelBounds(input: ResolvePanelBoundsInput): Rect {
  const { settings, display, panel } = input;

  const anchored = isUsableRect(settings);
  const rawX = anchored
    ? settings.x + (settings.width - panel.width) / 2
    : display.x + (display.width - panel.width) / 2;
  const rawY = anchored
    ? settings.y + settings.height - ANCHOR_OVERLAP_PX
    : display.y + display.height - panel.height - SCREEN_BOTTOM_INSET_PX;

  return {
    x: Math.round(clamp(rawX, display.x, display.x + display.width - panel.width)),
    y: Math.round(clamp(rawY, display.y, display.y + display.height - panel.height)),
    width: Math.round(panel.width),
    height: Math.round(panel.height),
  };
}
