import { mkdirSync } from "node:fs";
import { takeCoverage } from "node:v8";

export function flushHostE2ECoverage(onError?: (error: unknown) => void): boolean {
  if (process.env.CF_E2E_COVERAGE !== "1" || !process.env.NODE_V8_COVERAGE?.trim()) {
    return false;
  }
  try {
    mkdirSync(process.env.NODE_V8_COVERAGE, { recursive: true });
    takeCoverage();
    return true;
  } catch (error) {
    onError?.(error);
    return false;
  }
}
