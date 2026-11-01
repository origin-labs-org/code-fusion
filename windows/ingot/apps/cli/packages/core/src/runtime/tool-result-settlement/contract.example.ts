import type { ToolResultSettlement } from "./contract.js";

export function exampleToolResultSettlement(
  settle: ToolResultSettlement,
  runtime: ThisParameterType<ToolResultSettlement>,
  ...args: Parameters<ToolResultSettlement>
): Promise<void> {
  return settle.call(runtime, ...args);
}
