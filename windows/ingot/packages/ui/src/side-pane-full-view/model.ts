import type {
  ConversationPaneFloatingStatus,
  FloatingAnchor,
  FloatingAnswerBubbleState,
  SidePaneFullViewState,
} from "@/side-pane-full-view/contract.js";

export const SIDE_PANE_FULL_VIEW_ENTER_STATE: SidePaneFullViewState = {
  surface: "side-pane",
  floating: "collapsed",
};

export const FLOATING_ANCHORS: readonly FloatingAnchor[] = [
  "top-left",
  "top-right",
  "left-center",
  "right-center",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

export const DEFAULT_FLOATING_ANCHOR: FloatingAnchor = "bottom-right";
export const FLOATING_MARGIN_PX = 16;
export const FLOATING_WIDTH_PX = 560;
export const FLOATING_EXPANDED_MAX_HEIGHT_PX = 640;
export const FLOATING_MINIMIZED_SIZE_PX = 48;

export const FLOATING_DRAG_CLICK_THRESHOLD_PX = 4;

export interface FloatingRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface FloatingSize {
  readonly width: number;
  readonly height: number;
}

export interface FloatingPosition {
  readonly left: number;
  readonly top: number;
}

export function resolveFloatingWidth(slotWidth: number): number {
  return Math.max(0, Math.min(FLOATING_WIDTH_PX, slotWidth - FLOATING_MARGIN_PX * 2));
}

export function resolveFloatingExpandedHeight(slotHeight: number): number {
  return Math.max(
    0,
    Math.min(FLOATING_EXPANDED_MAX_HEIGHT_PX, slotHeight - FLOATING_MARGIN_PX * 2),
  );
}

export function clampFloatingPosition(
  position: FloatingPosition,
  slot: FloatingRect,
  size: FloatingSize,
): FloatingPosition {
  const maxLeft = slot.left + slot.width - size.width;
  const maxTop = slot.top + slot.height - size.height;
  return {
    left: Math.max(slot.left, Math.min(position.left, maxLeft)),
    top: Math.max(slot.top, Math.min(position.top, maxTop)),
  };
}

export function resolveFloatingPosition(
  anchor: FloatingAnchor,
  slot: FloatingRect,
  size: FloatingSize,
): FloatingPosition {
  const m = FLOATING_MARGIN_PX;
  const horizontal = anchor.includes("left")
    ? "start"
    : anchor.includes("right")
      ? "end"
      : "center";
  const vertical = anchor.startsWith("top")
    ? "start"
    : anchor.startsWith("bottom")
      ? "end"
      : "center";
  const left =
    horizontal === "start"
      ? slot.left + m
      : horizontal === "end"
        ? slot.left + slot.width - m - size.width
        : slot.left + (slot.width - size.width) / 2;
  const top =
    vertical === "start"
      ? slot.top + m
      : vertical === "end"
        ? slot.top + slot.height - m - size.height
        : slot.top + (slot.height - size.height) / 2;
  return clampFloatingPosition({ left, top }, slot, size);
}

export function resolveFloatingTransformOrigin(anchor: FloatingAnchor): string {
  const x = anchor.includes("left") ? "left" : anchor.includes("right") ? "right" : "center";
  const y = anchor.startsWith("top") ? "top" : anchor.startsWith("bottom") ? "bottom" : "center";
  return `${x} ${y}`;
}

export function resolveNearestFloatingAnchor(
  position: FloatingPosition,
  slot: FloatingRect,
  size: FloatingSize,
): FloatingAnchor {
  let best: FloatingAnchor = DEFAULT_FLOATING_ANCHOR;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of FLOATING_ANCHORS) {
    const resting = resolveFloatingPosition(anchor, slot, size);
    const distance = Math.hypot(resting.left - position.left, resting.top - position.top);
    if (distance < bestDistance) {
      best = anchor;
      bestDistance = distance;
    }
  }
  return best;
}

export function parseFloatingAnchor(raw: unknown): FloatingAnchor | null {
  return typeof raw === "string" && (FLOATING_ANCHORS as readonly string[]).includes(raw)
    ? (raw as FloatingAnchor)
    : null;
}

export function reduceFloatingAnswerBubbles(
  bubbles: ReadonlyMap<string, FloatingAnswerBubbleState>,
  status: Pick<ConversationPaneFloatingStatus, "ownerKey" | "latestTurn">,
): ReadonlyMap<string, FloatingAnswerBubbleState> {
  const turn = status.latestTurn;
  if (!turn?.turnKey) return bubbles;
  const current = bubbles.get(status.ownerKey) ?? { seenTurnKey: undefined, answer: null };
  let next = current;
  if (current.seenTurnKey === undefined) {
    next = { ...current, seenTurnKey: turn.running ? null : turn.turnKey };
  } else if (!turn.running && turn.answer && turn.turnKey !== current.seenTurnKey) {
    next = { seenTurnKey: turn.turnKey, answer: turn.answer };
  }
  if (next === current) return bubbles;
  const updated = new Map(bubbles);
  updated.set(status.ownerKey, next);
  return updated;
}

export function dismissFloatingAnswerBubble(
  bubbles: ReadonlyMap<string, FloatingAnswerBubbleState>,
  ownerKey: string,
): ReadonlyMap<string, FloatingAnswerBubbleState> {
  const current = bubbles.get(ownerKey);
  if (!current?.answer) return bubbles;
  const updated = new Map(bubbles);
  updated.set(ownerKey, { ...current, answer: null });
  return updated;
}

export function rebaselineFloatingAnswerBubbles(
  bubbles: ReadonlyMap<string, FloatingAnswerBubbleState>,
): ReadonlyMap<string, FloatingAnswerBubbleState> {
  if (![...bubbles.values()].some((bubble) => bubble.seenTurnKey !== undefined)) return bubbles;
  return new Map([...bubbles].map(([key, bubble]) => [key, { ...bubble, seenTurnKey: undefined }]));
}

export function resolveFloatingAnswerPreview(markdown: string): string {
  return (
    markdown
      .replace(/```[\s\S]*?(```|$)/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
      .replace(/(\*\*|~~|\*)(\S(?:.*?\S)?)\1/g, "$2")
      .replace(/\s+/g, " ")
      .trim()
  );
}
