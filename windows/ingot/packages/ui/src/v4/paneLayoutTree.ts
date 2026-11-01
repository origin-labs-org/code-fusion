//

export const V4_PRIMARY_PANE_ID = "workspace-main";

export const MAX_WORKBENCH_PANES = 4;

export const SPLIT_RATIO_MIN = 0.25;
export const SPLIT_RATIO_MAX = 0.75;
export const DEFAULT_SPLIT_RATIO = 0.5;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return DEFAULT_SPLIT_RATIO;
  }
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio));
}

export interface PaneWorkspaceScope {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly remoteSessionId?: string;
}

export function paneWorkspaceKey(scope: PaneWorkspaceScope): string {
  return scope.workspaceIdentity?.trim() || scope.workspacePath;
}

export function paneBindingMatchesSession(
  binding: PaneBinding | null | undefined,
  scope: PaneWorkspaceScope,
  sessionId: string,
): boolean {
  return Boolean(
    binding?.sessionId === sessionId &&
    paneWorkspaceKey(binding.workspaceScope) === paneWorkspaceKey(scope),
  );
}

export interface PaneBinding {
  
  readonly workspaceScope: PaneWorkspaceScope;
  
  readonly sessionId: string | null;
  
  readonly readOnly?: boolean;
  
  readonly restoredUnvalidated?: boolean;
}

export type SplitDirection = "row" | "column";

export type PaneSplitSide = "left" | "right" | "up" | "down";

export type PaneLayoutNode =
  | { readonly type: "leaf"; readonly paneId: string }
  | {
      readonly type: "split";
      
      readonly id: string;
      readonly direction: SplitDirection;
      
      readonly ratio: number;
      readonly first: PaneLayoutNode;
      readonly second: PaneLayoutNode;
    };

export interface PaneLayoutSnapshot {
  readonly root: PaneLayoutNode;
  
  readonly panes: Readonly<Record<string, PaneBinding>>;
  
  readonly focusedPaneId: string;
}

export const PRIMARY_LEAF: PaneLayoutNode = {
  type: "leaf",
  paneId: V4_PRIMARY_PANE_ID,
};

export const INITIAL_PANE_LAYOUT: PaneLayoutSnapshot = {
  root: PRIMARY_LEAF,
  panes: {},
  focusedPaneId: V4_PRIMARY_PANE_ID,
};

// ============================================================================
// ============================================================================

export function leafPaneIds(node: PaneLayoutNode): string[] {
  if (node.type === "leaf") {
    return [node.paneId];
  }
  return [...leafPaneIds(node.first), ...leafPaneIds(node.second)];
}

export function countPanes(state: PaneLayoutSnapshot): number {
  return leafPaneIds(state.root).length;
}

export function canAddPane(state: PaneLayoutSnapshot): boolean {
  return countPanes(state) < MAX_WORKBENCH_PANES;
}

function leafExists(node: PaneLayoutNode, paneId: string): boolean {
  if (node.type === "leaf") {
    return node.paneId === paneId;
  }
  return leafExists(node.first, paneId) || leafExists(node.second, paneId);
}

export function effectiveFocusedPaneId(state: PaneLayoutSnapshot): string {
  return leafExists(state.root, state.focusedPaneId)
    ? state.focusedPaneId
    : V4_PRIMARY_PANE_ID;
}

function allocatePaneId(root: PaneLayoutNode): string {
  let max = 0;
  for (const paneId of leafPaneIds(root)) {
    const match = /^pane-(\d+)$/.exec(paneId);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `pane-${max + 1}`;
}

function splitNodeIds(node: PaneLayoutNode): string[] {
  if (node.type === "leaf") {
    return [];
  }
  return [node.id, ...splitNodeIds(node.first), ...splitNodeIds(node.second)];
}

function allocateSplitNodeId(root: PaneLayoutNode): string {
  let max = 0;
  for (const id of splitNodeIds(root)) {
    const match = /^n(\d+)$/.exec(id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `n${max + 1}`;
}

function replaceLeaf(
  node: PaneLayoutNode,
  paneId: string,
  replacement: PaneLayoutNode,
): PaneLayoutNode {
  if (node.type === "leaf") {
    return node.paneId === paneId ? replacement : node;
  }
  const first = replaceLeaf(node.first, paneId, replacement);
  const second = replaceLeaf(node.second, paneId, replacement);
  if (first === node.first && second === node.second) {
    return node;
  }
  return { ...node, first, second };
}

function removeLeaf(
  node: PaneLayoutNode,
  paneId: string,
): PaneLayoutNode | null {
  if (node.type === "leaf") {
    return node.paneId === paneId ? null : node;
  }
  const first = removeLeaf(node.first, paneId);
  if (first === null) {
    return node.second;
  }
  const second = removeLeaf(node.second, paneId);
  if (second === null) {
    return node.first;
  }
  if (first === node.first && second === node.second) {
    return node;
  }
  return { ...node, first, second };
}

function replaceSplitRatio(
  node: PaneLayoutNode,
  splitId: string,
  ratio: number,
): PaneLayoutNode {
  if (node.type === "leaf") {
    return node;
  }
  if (node.id === splitId) {
    return node.ratio === ratio ? node : { ...node, ratio };
  }
  const first = replaceSplitRatio(node.first, splitId, ratio);
  const second = replaceSplitRatio(node.second, splitId, ratio);
  if (first === node.first && second === node.second) {
    return node;
  }
  return { ...node, first, second };
}

// ============================================================================
// ============================================================================

export function splitPaneAt(
  state: PaneLayoutSnapshot,
  anchorPaneId: string,
  direction: SplitDirection,
  binding: PaneBinding,
): PaneLayoutSnapshot {
  if (!leafExists(state.root, anchorPaneId) || !canAddPane(state)) {
    return state;
  }
  const newPaneId = allocatePaneId(state.root);
  const splitNode: PaneLayoutNode = {
    type: "split",
    id: allocateSplitNodeId(state.root),
    direction,
    ratio: DEFAULT_SPLIT_RATIO,
    first: { type: "leaf", paneId: anchorPaneId },
    second: { type: "leaf", paneId: newPaneId },
  };
  return {
    root: replaceLeaf(state.root, anchorPaneId, splitNode),
    panes: { ...state.panes, [newPaneId]: binding },
    focusedPaneId: newPaneId,
  };
}

export function splitPaneAtSide(
  state: PaneLayoutSnapshot,
  anchorPaneId: string,
  side: PaneSplitSide,
  binding: PaneBinding,
): PaneLayoutSnapshot {
  if (!leafExists(state.root, anchorPaneId) || !canAddPane(state)) {
    return state;
  }
  const newPaneId = allocatePaneId(state.root);
  const anchorLeaf: PaneLayoutNode = { type: "leaf", paneId: anchorPaneId };
  const newLeaf: PaneLayoutNode = { type: "leaf", paneId: newPaneId };
  const before = side === "left" || side === "up";
  const splitNode: PaneLayoutNode = {
    type: "split",
    id: allocateSplitNodeId(state.root),
    direction: side === "left" || side === "right" ? "row" : "column",
    ratio: DEFAULT_SPLIT_RATIO,
    first: before ? newLeaf : anchorLeaf,
    second: before ? anchorLeaf : newLeaf,
  };
  return {
    root: replaceLeaf(state.root, anchorPaneId, splitNode),
    panes: { ...state.panes, [newPaneId]: binding },
    focusedPaneId: newPaneId,
  };
}

export function closePane(
  state: PaneLayoutSnapshot,
  paneId: string,
): PaneLayoutSnapshot {
  if (paneId === V4_PRIMARY_PANE_ID || !leafExists(state.root, paneId)) {
    return state;
  }
  const root = removeLeaf(state.root, paneId) ?? PRIMARY_LEAF;
  const panes = { ...state.panes };
  delete panes[paneId];
  return {
    root,
    panes,
    focusedPaneId:
      state.focusedPaneId === paneId ? V4_PRIMARY_PANE_ID : state.focusedPaneId,
  };
}

export function bindPaneSession(
  state: PaneLayoutSnapshot,
  paneId: string,
  sessionId: string,
): PaneLayoutSnapshot {
  const binding = state.panes[paneId];
  if (
    !binding ||
    (binding.sessionId === sessionId && !binding.restoredUnvalidated)
  ) {
    return state;
  }
  return {
    ...state,
    panes: {
      ...state.panes,
      [paneId]: { workspaceScope: binding.workspaceScope, sessionId },
    },
  };
}

export function replacePaneBinding(
  state: PaneLayoutSnapshot,
  paneId: string,
  binding: PaneBinding,
): PaneLayoutSnapshot {
  if (!state.panes[paneId] || paneId === V4_PRIMARY_PANE_ID) {
    return state;
  }
  return {
    ...state,
    panes: {
      ...state.panes,
      [paneId]: binding,
    },
    focusedPaneId: paneId,
  };
}

export function findPaneIdForSession(
  state: PaneLayoutSnapshot,
  scope: PaneWorkspaceScope,
  sessionId: string,
): string | null {
  for (const [paneId, binding] of Object.entries(state.panes)) {
    if (paneBindingMatchesSession(binding, scope, sessionId)) {
      return paneId;
    }
  }
  return null;
}

export function setSplitNodeRatio(
  state: PaneLayoutSnapshot,
  splitId: string,
  ratio: number,
): PaneLayoutSnapshot {
  const root = replaceSplitRatio(state.root, splitId, clampSplitRatio(ratio));
  if (root === state.root) {
    return state;
  }
  return { ...state, root };
}

export function focusPane(
  state: PaneLayoutSnapshot,
  paneId: string,
): PaneLayoutSnapshot {
  if (state.focusedPaneId === paneId || !leafExists(state.root, paneId)) {
    return state;
  }
  return { ...state, focusedPaneId: paneId };
}

export function confirmRestoredPaneSession(
  state: PaneLayoutSnapshot,
  paneId: string,
): PaneLayoutSnapshot {
  const binding = state.panes[paneId];
  if (!binding?.restoredUnvalidated) {
    return state;
  }
  return {
    ...state,
    panes: {
      ...state.panes,
      [paneId]: {
        workspaceScope: binding.workspaceScope,
        sessionId: binding.sessionId,
      },
    },
  };
}

export function openSessionInNewPane(
  state: PaneLayoutSnapshot,
  scope: PaneWorkspaceScope,
  sessionId: string,
): PaneLayoutSnapshot {
  const workspaceKey = paneWorkspaceKey(scope);
  for (const [paneId, binding] of Object.entries(state.panes)) {
    if (
      binding.sessionId === sessionId &&
      paneWorkspaceKey(binding.workspaceScope) === workspaceKey
    ) {
      return focusPane(state, paneId);
    }
  }
  return splitPaneAt(state, effectiveFocusedPaneId(state), "row", {
    workspaceScope: scope,
    sessionId,
  });
}
