// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceManagerApp } from "@/resource-manager/ResourceManagerApp.js";

const { intl } = vi.hoisted(() => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }));
vi.mock("@/i18n/index.js", () => ({ useCfIntl: () => ({ intl }) }));
vi.mock("@/resource-manager/storage/StorageSection.js", () => ({ StorageSection: () => null }));
vi.mock("@/resource-manager/NetworkSection.js", () => ({ NetworkSection: () => null }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("resource manager polling", () => {
  it("Enabled only on CPU/Memory pages, disabled on tab switch and unmount, no stacking of slow queries", async () => {
    vi.useFakeTimers();
    const getSnapshot = vi.fn(() => new Promise<never>(() => {}));
    const setSamplingActive = vi.fn();
    const view = render(createElement(ResourceManagerApp, { getSnapshot, setSamplingActive }));
    expect(setSamplingActive).toHaveBeenLastCalledWith(true);
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(view.getByRole("tab", { name: "resourceManager.storage" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(setSamplingActive).toHaveBeenLastCalledWith(false);
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(view.getByRole("tab", { name: "resourceManager.network" }), {
      button: 0,
      ctrlKey: false,
    });
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(setSamplingActive).toHaveBeenLastCalledWith(false);
    fireEvent.mouseDown(view.getByRole("tab", { name: "resourceManager.memory" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(setSamplingActive).toHaveBeenLastCalledWith(true);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(setSamplingActive).toHaveBeenLastCalledWith(false);
  });
});
