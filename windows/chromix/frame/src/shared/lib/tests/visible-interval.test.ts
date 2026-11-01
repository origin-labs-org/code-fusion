import { afterEach, expect, test, vi } from "vitest";
import { everyWhileVisible } from "../visible-interval";

let state: DocumentVisibilityState = "visible";
const listeners = new Set<() => void>();
const stubDocument = () =>
  vi.stubGlobal("document", {
    get visibilityState() {
      return state;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  });
const become = (next: DocumentVisibilityState) => {
  state = next;
  for (const listener of listeners) listener();
};
afterEach(() => vi.useRealTimers());

test("ticks while visible, sleeps while hidden, and catches up when seen again", () => {
  vi.useFakeTimers();
  stubDocument();
  const tick = vi.fn();
  const stop = everyWhileVisible(60_000, tick);
  vi.advanceTimersByTime(120_000);
  expect(tick).toHaveBeenCalledTimes(2);
  become("hidden");
  vi.advanceTimersByTime(600_000);
  expect(tick).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  become("visible");
  expect(tick).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(60_000);
  expect(tick).toHaveBeenCalledTimes(4);
  stop();
  expect(vi.getTimerCount()).toBe(0);
  expect(listeners.size).toBe(0);
});
