// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { Emitter } from "@origin-ai/cf-rpc";
import type { IFileWatcherService } from "@origin-ai/cf-services";
import type { FileWatchEvent } from "@origin-ai/cf-shared";
import { describe, expect, it, vi } from "vitest";
import {
  shouldReloadPptxPreviewForWatchEvent,
  usePptxFileWatch,
} from "@/hooks/usePptxFileWatch.js";

vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

function createFileWatcherHarness() {
  const emitter = new Emitter<FileWatchEvent>();
  const watch = vi.fn(async () => ({ id: "watch-1" }));
  const unwatch = vi.fn(async () => {});
  const service = {
    watch,
    unwatch,
    disposeAll: vi.fn(),
    onDynamicChange: vi.fn(() => emitter.event),
  } satisfies IFileWatcherService;
  return { emitter, service, unwatch, watch };
}

describe("usePptxFileWatch", () => {
  it("先建立Parent directory订阅再Allow首读，并只为TargetorUnknown路径增加重载 generation", async () => {
    const { emitter, service, watch } = createFileWatcherHarness();
    const hook = renderHook(() =>
      usePptxFileWatch({
        filePath: "/workspace/slides/deck.pptx",
        fileWatcherService: service,
      }),
    );

    expect(hook.result.current.ready).toBe(false);
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(watch).toHaveBeenCalledWith({ path: "/workspace/slides" });
    expect(hook.result.current.reloadGeneration).toBe(0);

    act(() => {
      emitter.fire({
        dirPath: "/workspace/slides",
        changedPath: "/workspace/slides/notes.txt",
      });
    });
    expect(hook.result.current.reloadGeneration).toBe(0);

    act(() => {
      emitter.fire({
        dirPath: "/workspace/slides",
        changedPath: "/workspace/slides/deck.pptx",
      });
    });
    expect(hook.result.current.reloadGeneration).toBe(1);

    act(() => emitter.fire({ dirPath: "/workspace/slides" }));
    expect(hook.result.current.reloadGeneration).toBe(2);
  });

  it("切换 source and卸载时释放Old watcher，watch Failed时仍Allow基础Read", async () => {
    const first = createFileWatcherHarness();
    const second = createFileWatcherHarness();
    second.service.watch = vi.fn(async () => {
      throw new Error("watch unavailable");
    });

    const hook = renderHook(
      ({ filePath, fileWatcherService }) =>
        usePptxFileWatch({ filePath, fileWatcherService }),
      {
        initialProps: {
          filePath: "/workspace/first.pptx",
          fileWatcherService: first.service,
        },
      },
    );
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

    hook.rerender({
      filePath: "/remote/second.pptx",
      fileWatcherService: second.service,
    });
    expect(hook.result.current.ready).toBe(false);
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await waitFor(() =>
      expect(first.unwatch).toHaveBeenCalledWith({ id: "watch-1" }),
    );

    hook.unmount();
    expect(second.service.unwatch).not.toHaveBeenCalled();
  });

  it("同One路径切换 watcher service 时不会复用Old service 的 ready Status", async () => {
    const first = createFileWatcherHarness();
    const second = createFileWatcherHarness();
    second.service.watch = vi.fn(() => new Promise(() => {}));
    const observedReadyStates: boolean[] = [];

    const hook = renderHook(
      ({ fileWatcherService }) => {
        const result = usePptxFileWatch({
          filePath: "/workspace/deck.pptx",
          fileWatcherService,
        });
        observedReadyStates.push(result.ready);
        return result;
      },
      {
        initialProps: { fileWatcherService: first.service },
      },
    );
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

    observedReadyStates.length = 0;
    hook.rerender({ fileWatcherService: second.service });

    expect(observedReadyStates[0]).toBe(false);
    expect(hook.result.current.ready).toBe(false);
    await waitFor(() => expect(first.unwatch).toHaveBeenCalledWith({ id: "watch-1" }));
  });
});

describe("shouldReloadPptxPreviewForWatchEvent", () => {
  it("Compatible Windows 分隔符、盘符大小写andOld Host 的Table of Contents级Events", () => {
    expect(
      shouldReloadPptxPreviewForWatchEvent(
        { dirPath: "C:\\Workspace", changedPath: "c:\\workspace\\Deck.pptx" },
        "C:\\Workspace\\Deck.pptx",
      ),
    ).toBe(true);
    expect(
      shouldReloadPptxPreviewForWatchEvent(
        { dirPath: "/workspace" },
        "/workspace/deck.pptx",
      ),
    ).toBe(true);
  });
});
