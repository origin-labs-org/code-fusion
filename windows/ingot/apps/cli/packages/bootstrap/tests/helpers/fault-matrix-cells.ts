

import type { WireFormat } from "./fake-provider-server.js";
import type { ScriptShape } from "./fault-matrix-scripts.js";

const FAULT_MATRIX_FULL: boolean = process.env.CF_FAULT_MATRIX === "full";

export interface CellCoordinate {
  shape: ScriptShape;
  apiFormat?: WireFormat;
}

export function cells(quick: CellCoordinate[], fullOnly: CellCoordinate[] = []): CellCoordinate[] {
  return FAULT_MATRIX_FULL ? [...quick, ...fullOnly] : quick;
}

export function cellName(cell: CellCoordinate): string {
  return `${cell.shape}/${cell.apiFormat ?? "anthropic-messages"}`;
}

export const CELL_TIMEOUT_MS = 30_000;

export const POST_SETTLE_GRACE_MS = 200;
