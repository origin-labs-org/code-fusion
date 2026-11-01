import type { CSSProperties } from "react";
import type { PaneLayoutNode, SplitDirection } from "@/v4/paneLayoutTree.js";

export const SPLIT_VAR_PREFIX = "--v4-split-";

export interface RectExpr {
  left: string;
  top: string;
  width: string;
  height: string;
}

export interface LeafLayout {
  paneId: string;
  rect: RectExpr;
}

export interface DividerLayout {
  splitId: string;
  direction: SplitDirection;
  
  ratio: number;
  
  regionFraction: number;
  
  boundary: string;
  
  crossStart: string;
  crossLength: string;
}

export const FULL_WORKBENCH_RECT: RectExpr = {
  left: "0%",
  top: "0%",
  width: "100%",
  height: "100%",
};

function collectNode(
  node: PaneLayoutNode,
  rect: RectExpr,
  widthFraction: number,
  heightFraction: number,
  leaves: LeafLayout[],
  dividers: DividerLayout[],
): void {
  if (node.type === "leaf") {
    leaves.push({ paneId: node.paneId, rect });
    return;
  }
  const ratioVar = `var(${SPLIT_VAR_PREFIX}${node.id}, ${node.ratio})`;
  if (node.direction === "row") {
    const boundary = `(${rect.left}) + (${rect.width}) * ${ratioVar}`;
    dividers.push({
      splitId: node.id,
      direction: "row",
      ratio: node.ratio,
      regionFraction: widthFraction,
      boundary,
      crossStart: rect.top,
      crossLength: rect.height,
    });
    collectNode(
      node.first,
      { ...rect, width: `(${rect.width}) * ${ratioVar}` },
      widthFraction * node.ratio,
      heightFraction,
      leaves,
      dividers,
    );
    collectNode(
      node.second,
      { ...rect, left: boundary, width: `(${rect.width}) * (1 - ${ratioVar})` },
      widthFraction * (1 - node.ratio),
      heightFraction,
      leaves,
      dividers,
    );
    return;
  }
  const boundary = `(${rect.top}) + (${rect.height}) * ${ratioVar}`;
  dividers.push({
    splitId: node.id,
    direction: "column",
    ratio: node.ratio,
    regionFraction: heightFraction,
    boundary,
    crossStart: rect.left,
    crossLength: rect.width,
  });
  collectNode(
    node.first,
    { ...rect, height: `(${rect.height}) * ${ratioVar}` },
    widthFraction,
    heightFraction * node.ratio,
    leaves,
    dividers,
  );
  collectNode(
    node.second,
    { ...rect, top: boundary, height: `(${rect.height}) * (1 - ${ratioVar})` },
    widthFraction,
    heightFraction * (1 - node.ratio),
    leaves,
    dividers,
  );
}

export interface WorkbenchLayout {
  leaves: LeafLayout[];
  dividers: DividerLayout[];
}

export function collectWorkbenchLayout(root: PaneLayoutNode): WorkbenchLayout {
  const leaves: LeafLayout[] = [];
  const dividers: DividerLayout[] = [];
  collectNode(root, FULL_WORKBENCH_RECT, 1, 1, leaves, dividers);
  return { leaves, dividers };
}

export function rectStyle(rect: RectExpr): CSSProperties {
  return {
    left: `calc(${rect.left})`,
    top: `calc(${rect.top})`,
    width: `calc(${rect.width})`,
    height: `calc(${rect.height})`,
  };
}

export function dividerStyle(divider: DividerLayout): CSSProperties {
  if (divider.direction === "row") {
    return {
      left: `calc(${divider.boundary})`,
      top: `calc(${divider.crossStart})`,
      height: `calc(${divider.crossLength})`,
      width: "9px",
      transform: "translateX(-50%)",
    };
  }
  return {
    top: `calc(${divider.boundary})`,
    left: `calc(${divider.crossStart})`,
    width: `calc(${divider.crossLength})`,
    height: "9px",
    transform: "translateY(-50%)",
  };
}
