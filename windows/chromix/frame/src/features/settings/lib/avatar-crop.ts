import type { AccountAvatarCropV1 } from "$shared/ipc/bindings";

/**
 * A picture framed in a square window of `view` CSS pixels: how far it is
 * zoomed past covering the window, and where its top-left corner sits.
 * Display-only; the crop Rust cuts is worked out from it.
 */
export type Framing = {
  width: number;
  height: number;
  view: number;
  zoom: number;
  x: number;
  y: number;
};

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

const scaleOf = (frame: Framing) =>
  (frame.view / Math.max(1, Math.min(frame.width, frame.height))) * frame.zoom;

/** The picture's drawn size. */
export function fitted(frame: Framing) {
  const scale = scaleOf(frame);
  return { width: frame.width * scale, height: frame.height * scale };
}

/** Never lets the window show past the picture's edge. */
function held(frame: Framing): Framing {
  const { width, height } = fitted(frame);
  const clamp = (value: number, size: number) => Math.min(0, Math.max(frame.view - size, value));
  return { ...frame, x: clamp(frame.x, width), y: clamp(frame.y, height) };
}

/** A picture centred and just covering the window. */
export function framing(width: number, height: number, view: number): Framing {
  const frame = { width, height, view, zoom: MIN_ZOOM, x: 0, y: 0 };
  const shown = fitted(frame);
  return held({ ...frame, x: (view - shown.width) / 2, y: (view - shown.height) / 2 });
}

export const moved = (frame: Framing, dx: number, dy: number) =>
  held({ ...frame, x: frame.x + dx, y: frame.y + dy });

/** Zooms about the window's centre, so what is in the middle stays there. */
export function zoomed(frame: Framing, zoom: number): Framing {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const before = scaleOf(frame);
  const after = scaleOf({ ...frame, zoom: next });
  const middle = frame.view / 2;
  const x = middle - ((middle - frame.x) / before) * after;
  const y = middle - ((middle - frame.y) / before) * after;
  return held({ ...frame, zoom: next, x, y });
}

/** The square inside the window, in the preview's own pixels. */
export function cropOf(frame: Framing): AccountAvatarCropV1 {
  const scale = scaleOf(frame);
  const limit = Math.min(frame.width, frame.height);
  const side = Math.max(1, Math.min(limit, Math.round(frame.view / scale)));
  const x = Math.min(frame.width - side, Math.max(0, Math.round(-frame.x / scale)));
  const y = Math.min(frame.height - side, Math.max(0, Math.round(-frame.y / scale)));
  return { x, y, side };
}
