import { expect } from "vitest";
import type { ToolEntry } from "../src/tool/types.js";

export function expectV2CommonContract(entry: ToolEntry): void {
  const name = entry.metadata.name;
  expect(entry.capability, name).toBeTruthy();
  expect(entry.inputSchema, name).toEqual(expect.any(Object));
  expect(entry.outputSchema, name).toEqual(expect.any(Object));
  expect(entry.runtimeInputSchema, name).toBeTruthy();
  expect(entry.runtimeOutputSchema, name).toBeTruthy();
  expect(entry.permission.permission, name).toBeTruthy();
  expect(entry.permission.reason, name).toBeTruthy();
  expect(entry.permission.riskLevel, name).toBe(entry.metadata.riskLevel);
  expect(entry.permission.sideEffectScope, name).toBe(entry.metadata.sideEffectScope);
  expect(entry.permission.needsApproval, name).toBe(entry.metadata.needsApproval);
  expect(entry.resultBudget.maxInlineBytes, name).toBeGreaterThan(0);
  expect(entry.resultBudget.maxModelBytes, name).toBeGreaterThan(0);
  if (entry.timeout.kind === "none") {
    expect(entry.metadata.timeoutMs, name).toBeUndefined();
  } else {
    expect(entry.timeout.defaultMs, name).toBe(entry.metadata.timeoutMs);
  }
  expect(entry.cancellation.userVisibleMessage, name).toBeTruthy();
  expect(entry.trace.required, name).toBe(true);
}
