//
//
//

export const BOTTOM_ANCHOR_EPSILON_PX = 48;

export interface TimelineScrollMetrics {
  
  scrollTop: number;
  
  viewportHeight: number;
  
  contentHeight: number;
}

export function distanceToBottom(metrics: TimelineScrollMetrics): number {
  return Math.max(
    0,
    metrics.contentHeight - metrics.viewportHeight - metrics.scrollTop,
  );
}

export function isAtBottom(
  metrics: TimelineScrollMetrics,
  epsilonPx: number = BOTTOM_ANCHOR_EPSILON_PX,
): boolean {
  return distanceToBottom(metrics) <= epsilonPx;
}

export function nextFollowingAfterScroll(
  metrics: TimelineScrollMetrics,
  epsilonPx: number = BOTTOM_ANCHOR_EPSILON_PX,
): boolean {
  return isAtBottom(metrics, epsilonPx);
}

export type TimelineScrollEventSource = "user" | "programmatic" | "layout";

export function resolveFollowingAfterScroll(input: {
  following: boolean;
  metrics: TimelineScrollMetrics;
  source: TimelineScrollEventSource;
  epsilonPx?: number;
}): boolean {
  if (input.source !== "user") return input.following;
  return nextFollowingAfterScroll(input.metrics, input.epsilonPx);
}

export function anchorActionAfterContentChange(
  following: boolean,
  contentWidthChanging: boolean = false,
): "stickToBottom" | "hold" {
  return following && !contentWidthChanging ? "stickToBottom" : "hold";
}

export function shouldAdjustVirtualizerForItemSizeChange(input: {
  following: boolean;
  suppressAdjustment: boolean;
  contentWidthChanging: boolean;
  itemEnd: number;
  scrollTop: number;
}): boolean {
  if (
    input.suppressAdjustment ||
    input.following ||
    input.contentWidthChanging
  ) {
    return false;
  }
  return input.itemEnd <= input.scrollTop;
}

export const UNOBSERVED_SCROLL_EPSILON_PX = 2;

export type TimelineUserScrollIntent =
  | "none"
  | "awayFromBottom"
  | "towardBottom"
  | "unknown";

export function timelineWheelScrollIntent(
  deltaY: number,
): TimelineUserScrollIntent {
  if (deltaY < 0) return "awayFromBottom";
  if (deltaY > 0) return "towardBottom";
  return "none";
}

export function timelineTouchScrollIntent(
  previousClientY: number,
  nextClientY: number,
): TimelineUserScrollIntent {
  if (nextClientY > previousClientY) return "awayFromBottom";
  if (nextClientY < previousClientY) return "towardBottom";
  return "none";
}

export function timelineKeyboardScrollIntent(input: {
  key: string;
  shiftKey: boolean;
  editableTarget: boolean;
}): TimelineUserScrollIntent {
  if (input.editableTarget) return "none";
  if (
    input.key === "ArrowUp" ||
    input.key === "PageUp" ||
    input.key === "Home"
  ) {
    return "awayFromBottom";
  }
  if (
    input.key === "ArrowDown" ||
    input.key === "PageDown" ||
    input.key === "End"
  ) {
    return "towardBottom";
  }
  if (input.key === " ") {
    return input.shiftKey ? "awayFromBottom" : "towardBottom";
  }
  return "none";
}

export function reconcileFollowingForContentAnchor(input: {
  
  following: boolean;
  
  metrics: TimelineScrollMetrics;
  
  lastObservedScrollTop: number;
  
  userScrollIntent?: TimelineUserScrollIntent;
  bottomEpsilonPx?: number;
  scrollEpsilonPx?: number;
}): boolean {
  const userScrollIntent = input.userScrollIntent ?? "unknown";
  if (userScrollIntent === "awayFromBottom") return false;
  if (userScrollIntent === "none") return input.following;
  if (
    isAtBottom(input.metrics, input.bottomEpsilonPx ?? BOTTOM_ANCHOR_EPSILON_PX)
  ) {
    return true;
  }
  const unobservedUpscroll =
    input.metrics.scrollTop <
    input.lastObservedScrollTop -
      (input.scrollEpsilonPx ?? UNOBSERVED_SCROLL_EPSILON_PX);
  if (unobservedUpscroll) {
    return false;
  }
  return input.following;
}

export function shouldShowBackToBottom(
  following: boolean,
  rowCount: number,
): boolean {
  return !following && rowCount > 0;
}

export function initialFollowing(): boolean {
  return true;
}

//
//   scrollTop' = scrollTop + (nextTotalSize - prevTotalSize)

export interface PrependVirtualAnchor {
  key: string;
  
  offsetTop: number;
  start: number;
}

export function prependVirtualAnchorAdjustment(
  previous: PrependVirtualAnchor,
  next: PrependVirtualAnchor,
  currentScrollTop: number,
): number | null {
  if (previous.key !== next.key) return null;
  if (
    !Number.isFinite(previous.offsetTop) ||
    !Number.isFinite(next.start) ||
    !Number.isFinite(currentScrollTop)
  ) {
    return null;
  }
  return next.start - previous.offsetTop - currentScrollTop;
}

export interface PrependAnchorInput {
  
  prevFirstRowId: number | null;
  
  nextFirstRowId: number | null;
  
  prevTotalSize: number;
  
  nextTotalSize: number;
}

export function prependScrollAdjustment(
  input: PrependAnchorInput,
): number | null {
  if (input.prevFirstRowId === null || input.nextFirstRowId === null) {
    return null;
  }
  if (input.nextFirstRowId >= input.prevFirstRowId) return null;
  const delta = input.nextTotalSize - input.prevTotalSize;
  return delta > 0 ? delta : null;
}

export const LOAD_OLDER_TRIGGER_PX = 64;

export const LOAD_OLDER_PREFETCH_VIEWPORTS = 2;

export function historyPrefetchTriggerPx(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return LOAD_OLDER_TRIGGER_PX;
  }
  return Math.max(
    LOAD_OLDER_TRIGGER_PX,
    viewportHeight * LOAD_OLDER_PREFETCH_VIEWPORTS,
  );
}

export function shouldTriggerLoadOlder(input: {
  scrollTop: number;
  canLoadOlder: boolean;
  loadingOlder: boolean;
  triggerPx?: number;
}): boolean {
  return (
    input.canLoadOlder &&
    !input.loadingOlder &&
    input.scrollTop <= (input.triggerPx ?? LOAD_OLDER_TRIGGER_PX)
  );
}
