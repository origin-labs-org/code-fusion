
export const CONVERSATION_SHARE_SELECTION_PANEL_EDGE_INSET_PX = 24;
export const CONVERSATION_SHARE_SELECTION_PANEL_DOCK_GAP_PX = 16;

export const CONVERSATION_SHARE_SELECTION_PANEL_MIN_HEIGHT_PX = 120;
export const CONVERSATION_SHARE_SELECTION_PANEL_MAX_HEIGHT_PROPERTY =
  "--conversation-share-selection-panel-max-height";
export const CONVERSATION_SHARE_SELECTION_PANEL_CENTER_Y_PROPERTY =
  "--conversation-share-selection-panel-center-y";

export interface ConversationShareSelectionPanelLayoutInput {
  
  containerHeightPx: number;
  
  dockStartPx: number;
}

export interface ConversationShareSelectionPanelLayout {
  centerYPx: number;
  maxHeightPx: number;
  topPx: number;
  bottomPx: number;
}

function normalizeSize(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function resolveConversationShareSelectionPanelLayout({
  containerHeightPx,
  dockStartPx,
}: ConversationShareSelectionPanelLayoutInput): ConversationShareSelectionPanelLayout {
  const containerHeight = normalizeSize(containerHeightPx);
  const dockStart = Math.min(containerHeight, normalizeSize(dockStartPx));
  const unconstrainedMaxHeight = Math.max(
    0,
    containerHeight - CONVERSATION_SHARE_SELECTION_PANEL_EDGE_INSET_PX * 2,
  );
  const minHeight = Math.min(
    unconstrainedMaxHeight,
    CONVERSATION_SHARE_SELECTION_PANEL_MIN_HEIGHT_PX,
  );
  const top = Math.max(
    0,
    Math.min(
      CONVERSATION_SHARE_SELECTION_PANEL_EDGE_INSET_PX,
      dockStart - CONVERSATION_SHARE_SELECTION_PANEL_DOCK_GAP_PX - minHeight,
    ),
  );
  const availableHeight = Math.max(
    0,
    dockStart - CONVERSATION_SHARE_SELECTION_PANEL_DOCK_GAP_PX - top,
  );
  const maxHeight = Math.max(minHeight, Math.min(unconstrainedMaxHeight, availableHeight));

  return {
    centerYPx: top + maxHeight / 2,
    maxHeightPx: maxHeight,
    topPx: top,
    bottomPx: top + maxHeight,
  };
}

export function syncConversationShareSelectionPanelLayout(
  container: HTMLElement,
  dock: HTMLElement,
): ConversationShareSelectionPanelLayout {
  const containerRect = container.getBoundingClientRect();
  const dockRect = dock.getBoundingClientRect();
  const layout = resolveConversationShareSelectionPanelLayout({
    containerHeightPx: containerRect.height,
    dockStartPx: dockRect.top - containerRect.top,
  });
  const maxHeight = `${layout.maxHeightPx}px`;
  const centerY = `${layout.centerYPx}px`;

  if (
    container.style.getPropertyValue(CONVERSATION_SHARE_SELECTION_PANEL_MAX_HEIGHT_PROPERTY) !==
    maxHeight
  ) {
    container.style.setProperty(CONVERSATION_SHARE_SELECTION_PANEL_MAX_HEIGHT_PROPERTY, maxHeight);
  }
  if (
    container.style.getPropertyValue(CONVERSATION_SHARE_SELECTION_PANEL_CENTER_Y_PROPERTY) !==
    centerY
  ) {
    container.style.setProperty(CONVERSATION_SHARE_SELECTION_PANEL_CENTER_Y_PROPERTY, centerY);
  }

  return layout;
}
