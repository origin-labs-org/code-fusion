// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddedBrowserWebviewChannels } from "@origin-ai/cf-shared";
import { installEmbeddedBrowserWheelForwarding } from "../src/preload/embeddedBrowserWheel.js";

function setScrollGeometry(
  element: HTMLElement,
  geometry: {
    clientHeight?: number;
    clientWidth?: number;
    scrollHeight?: number;
    scrollLeft?: number;
    scrollTop?: number;
    scrollWidth?: number;
  },
): void {
  for (const [property, value] of Object.entries(geometry)) {
    Object.defineProperty(element, property, {
      configurable: true,
      value,
      writable: property === "scrollLeft" || property === "scrollTop",
    });
  }
}

function dispatchWheel(
  target: HTMLElement,
  init: WheelEventInit,
): { event: WheelEvent; settled: Promise<void> } {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return { event, settled: Promise.resolve() };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("embedded browser wheel forwarding", () => {
  it("Forward 2D pixel delta to host when guest has no scroll container", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const sendToHost = vi.fn();
    const dispose = installEmbeddedBrowserWheelForwarding(window, sendToHost);

    await dispatchWheel(target, { deltaX: 120, deltaY: 80 }).settled;

    expect(sendToHost).toHaveBeenCalledWith(EmbeddedBrowserWebviewChannels.WheelBoundary, {
      deltaX: 120,
      deltaY: 80,
    });
    dispose();
  });

  it("Do not forward the axis when guest inner layers or ancestors can still consume scroll in that direction", async () => {
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    outer.style.overflowX = "auto";
    inner.style.overflowY = "auto";
    outer.append(inner);
    document.body.append(outer);
    setScrollGeometry(outer, {
      clientWidth: 100,
      scrollLeft: 0,
      scrollWidth: 300,
    });
    setScrollGeometry(inner, {
      clientHeight: 100,
      scrollHeight: 300,
      scrollTop: 40,
    });
    const sendToHost = vi.fn();
    const dispose = installEmbeddedBrowserWheelForwarding(window, sendToHost);

    await dispatchWheel(inner, { deltaX: 80, deltaY: 80 }).settled;

    expect(sendToHost).not.toHaveBeenCalled();
    dispose();
  });

  it("Continue forwarding to host after guest reaches the boundary on corresponding axis", async () => {
    const target = document.createElement("div");
    target.style.overflow = "auto";
    document.body.append(target);
    setScrollGeometry(target, {
      clientHeight: 100,
      clientWidth: 100,
      scrollHeight: 300,
      scrollLeft: 200,
      scrollTop: 200,
      scrollWidth: 300,
    });
    const sendToHost = vi.fn();
    const dispose = installEmbeddedBrowserWheelForwarding(window, sendToHost);

    await dispatchWheel(target, { deltaX: 80, deltaY: 90 }).settled;

    expect(sendToHost).toHaveBeenCalledWith(EmbeddedBrowserWebviewChannels.WheelBoundary, {
      deltaX: 80,
      deltaY: 90,
    });
    dispose();
  });

  it("Vertical scrolling determines boundary based on direction", async () => {
    const target = document.createElement("div");
    target.style.overflowY = "auto";
    document.body.append(target);
    setScrollGeometry(target, {
      clientHeight: 100,
      scrollHeight: 300,
      scrollTop: 0,
    });
    const sendToHost = vi.fn();
    const dispose = installEmbeddedBrowserWheelForwarding(window, sendToHost);

    await dispatchWheel(target, { deltaY: 80 }).settled;
    expect(sendToHost).not.toHaveBeenCalled();

    await dispatchWheel(target, { deltaY: -80 }).settled;
    expect(sendToHost).toHaveBeenCalledWith(EmbeddedBrowserWebviewChannels.WheelBoundary, {
      deltaX: 0,
      deltaY: -80,
    });
    dispose();
  });

  it("Respect webpage preventDefault and normalize line and Shift+wheel", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const sendToHost = vi.fn();
    const dispose = installEmbeddedBrowserWheelForwarding(window, sendToHost);

    target.addEventListener("wheel", (event) => event.preventDefault(), { once: true });
    await dispatchWheel(target, { deltaY: 90 }).settled;
    await dispatchWheel(target, { deltaMode: 1, deltaY: 3, shiftKey: true }).settled;
    await dispatchWheel(target, { deltaMode: 1, deltaY: 2 }).settled;

    expect(sendToHost).toHaveBeenCalledTimes(2);
    expect(sendToHost).toHaveBeenNthCalledWith(1, EmbeddedBrowserWebviewChannels.WheelBoundary, {
      deltaX: 120,
      deltaY: 0,
    });
    expect(sendToHost).toHaveBeenNthCalledWith(2, EmbeddedBrowserWebviewChannels.WheelBoundary, {
      deltaX: 0,
      deltaY: 80,
    });
    dispose();
  });
});
