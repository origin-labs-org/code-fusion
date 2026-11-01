import { describe, expect, it } from "vitest";
import {
  consumeCfJwtInvalidRestartMarker,
  markCfJwtInvalidRestart,
} from "../src/root/cfJwtInvalidRestartMarker.js";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("cf JWT invalid restart marker", () => {
  it("is consumed exactly once after relaunch", () => {
    const storage = createStorage();
    markCfJwtInvalidRestart(storage);

    expect(consumeCfJwtInvalidRestartMarker(storage)).toBe(true);
    expect(consumeCfJwtInvalidRestartMarker(storage)).toBe(false);
  });
});
