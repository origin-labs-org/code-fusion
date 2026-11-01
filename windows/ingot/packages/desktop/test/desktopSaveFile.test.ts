import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  agentOptions: [] as Array<{ connect?: { lookup?: Function } }>,
  copyFile: vi.fn(),
  dispatcherClose: vi.fn(),
  handler: null as ((event: unknown, payload: unknown) => Promise<unknown>) | null,
  fileClose: vi.fn(),
  fileWrite: vi.fn(),
  lookup: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  showSaveDialog: vi.fn(),
  undiciFetch: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("undici", () => ({
  Agent: function Agent(options: { connect?: { lookup?: Function } }) {
    mocks.agentOptions.push(options);
    return { close: mocks.dispatcherClose };
  },
  fetch: mocks.undiciFetch,
}));

vi.mock("node:dns/promises", () => ({
  lookup: mocks.lookup,
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showSaveDialog: mocks.showSaveDialog },
  ipcMain: {
    handle: vi.fn(
      (_channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
        mocks.handler = handler;
      },
    ),
  },
}));

vi.mock("node:fs/promises", () => ({
  copyFile: mocks.copyFile,
  mkdtemp: mocks.mkdtemp,
  open: vi.fn(async () => ({
    close: mocks.fileClose,
    write: mocks.fileWrite,
  })),
  rm: mocks.rm,
  writeFile: mocks.writeFile,
}));

describe("desktopSaveFile", () => {
  beforeEach(async () => {
    mocks.handler = null;
    mocks.agentOptions.length = 0;
    mocks.copyFile.mockReset();
    mocks.copyFile.mockResolvedValue(undefined);
    mocks.dispatcherClose.mockReset();
    mocks.dispatcherClose.mockResolvedValue(undefined);
    mocks.fileClose.mockReset();
    mocks.fileClose.mockResolvedValue(undefined);
    mocks.fileWrite.mockReset();
    mocks.fileWrite.mockResolvedValue(undefined);
    mocks.mkdtemp.mockReset();
    mocks.mkdtemp.mockResolvedValue("/tmp/cf-save-file-test");
    mocks.lookup.mockReset();
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mocks.rm.mockReset();
    mocks.rm.mockResolvedValue(undefined);
    mocks.showSaveDialog.mockReset();
    mocks.undiciFetch.mockReset();
    mocks.writeFile.mockReset();
    vi.unstubAllGlobals();
    const { registerDesktopSaveFileIpcHandler } = await import("../src/main/desktopSaveFile.js");
    registerDesktopSaveFileIpcHandler({ warn: vi.fn() });
    expect(mocks.handler).not.toBeNull();
  });

  it("Writes image bytes to local file after user selects a path", async () => {
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: "/tmp/cat.png",
    });
    const data = new Uint8Array([1, 2, 3]).buffer;

    await expect(
      mocks.handler?.({ sender: {} }, { data, suggestedName: "cat.png" }),
    ).resolves.toEqual({
      success: true,
      path: "/tmp/cat.png",
    });
    expect(mocks.writeFile).toHaveBeenCalledWith("/tmp/cat.png", new Uint8Array([1, 2, 3]));
  });

  it("Does not write file when user cancels Save As", async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true });
    const data = new Uint8Array([1]).buffer;

    await expect(
      mocks.handler?.({ sender: {} }, { data, suggestedName: "cat.png" }),
    ).resolves.toEqual({
      success: false,
      canceled: true,
    });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("Streams download of non-CORS remote images in main process and writes to user path", async () => {
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: "/tmp/cat.png",
    });
    const reader = {
      cancel: vi.fn(async () => undefined),
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
        .mockResolvedValueOnce({ done: true }),
    };
    mocks.undiciFetch.mockImplementation(async () => ({
      body: { getReader: () => reader },
      headers: new Headers({ "content-length": "3", "content-type": "image/png" }),
      ok: true,
      status: 200,
    }));

    await expect(
      mocks.handler?.(
        { sender: {} },
        { sourceUrl: "https://images.example.test/cat.png", suggestedName: "cat.png" },
      ),
    ).resolves.toEqual({
      success: true,
      path: "/tmp/cat.png",
    });
    expect(mocks.fileWrite).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(mocks.copyFile).toHaveBeenCalledWith(
      join("/tmp/cf-save-file-test", "download"),
      "/tmp/cat.png",
    );
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/cf-save-file-test", {
      force: true,
      recursive: true,
    });
    expect(mocks.agentOptions[0]?.connect?.lookup).toBeTypeOf("function");
  });

  it("Rejects images exceeding 50 MiB based on Content-Length before reading remote response", async () => {
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: "/tmp/large.png",
    });
    const reader = { cancel: vi.fn(async () => undefined), read: vi.fn() };
    mocks.undiciFetch.mockImplementation(async () => ({
      body: { getReader: () => reader },
      headers: new Headers({ "content-length": String(50 * 1024 * 1024 + 1) }),
      ok: true,
      status: 200,
    }));

    await expect(
      mocks.handler?.(
        { sender: {} },
        { sourceUrl: "https://images.example.test/large.png", suggestedName: "large.png" },
      ),
    ).resolves.toEqual({
      success: false,
      error: "file_too_large",
    });
    expect(reader.read).not.toHaveBeenCalled();
    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalled();
  });

  it("Aborts and cleans up chunked responses without Content-Length at 51 MiB", async () => {
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: "/tmp/chunked-large.png",
    });
    const oneMiBChunk = new Uint8Array(1024 * 1024);
    let chunkIndex = 0;
    const reader = {
      cancel: vi.fn(async () => undefined),
      read: vi.fn(async () =>
        chunkIndex++ < 51 ? { done: false, value: oneMiBChunk } : { done: true },
      ),
    };
    mocks.undiciFetch.mockImplementation(async () => ({
      body: { getReader: () => reader },
      headers: new Headers(),
      ok: true,
      status: 200,
    }));

    await expect(
      mocks.handler?.(
        { sender: {} },
        {
          sourceUrl: "https://images.example.test/chunked-large.png",
          suggestedName: "chunked-large.png",
        },
      ),
    ).resolves.toEqual({
      success: false,
      error: "file_too_large",
    });
    expect(mocks.fileWrite).toHaveBeenCalledTimes(50);
    expect(reader.cancel).toHaveBeenCalled();
    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalled();
  });

  it("Rejects direct access to local or private network image addresses", async () => {
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: "/tmp/private.png",
    });
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const fetchMock = vi.fn();
    mocks.undiciFetch.mockImplementation(fetchMock);

    await expect(
      mocks.handler?.(
        { sender: {} },
        { sourceUrl: "http://internal.example/cat.png", suggestedName: "cat.png" },
      ),
    ).resolves.toEqual({
      success: false,
      error: "remote_address_not_allowed",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalled();
  });

  it("Manually validates redirect targets and rejects redirects to private networks", async () => {
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: "/tmp/redirect.png",
    });
    mocks.lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const redirectBody = { cancel: vi.fn(async () => undefined) };
    const fetchMock = vi.fn(async () => ({
      body: redirectBody,
      headers: new Headers({ location: "http://metadata.internal/image.png" }),
      status: 302,
    }));
    mocks.undiciFetch.mockImplementation(fetchMock);

    await expect(
      mocks.handler?.(
        { sender: {} },
        { sourceUrl: "https://images.example.test/cat.png", suggestedName: "cat.png" },
      ),
    ).resolves.toEqual({
      success: false,
      error: "remote_address_not_allowed",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(redirectBody.cancel).toHaveBeenCalled();
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });

  it("Aborts and cleans up when remote response exceeds total timeout", async () => {
    vi.useFakeTimers();
    try {
      mocks.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: "/tmp/slow.png",
      });
      mocks.undiciFetch.mockImplementation(
        (_url: URL, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );

      const resultPromise = mocks.handler?.(
        { sender: {} },
        { sourceUrl: "https://images.example.test/slow.png", suggestedName: "slow.png" },
      );
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(resultPromise).resolves.toEqual({
        success: false,
        error: "write_failed",
      });
      expect(mocks.rm).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Only return pre-validated fixed addresses during connection, ignoring subsequent DNS rebinding", async () => {
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: "/tmp/pinned.png",
    });
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const reader = {
      cancel: vi.fn(async () => undefined),
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new Uint8Array([1]),
        })
        .mockResolvedValueOnce({ done: true }),
    };
    mocks.undiciFetch.mockImplementation(async () => {
      const pinnedLookup = mocks.agentOptions[0]?.connect?.lookup;
      expect(pinnedLookup).toBeTypeOf("function");
      const connectedAddress = await new Promise<string>((resolve, reject) => {
        pinnedLookup?.(
          "images.example.test",
          { all: false },
          (error: Error | null, address: string) => (error ? reject(error) : resolve(address)),
        );
      });
      expect(connectedAddress).toBe("93.184.216.34");
      return {
        body: { getReader: () => reader },
        headers: new Headers({ "content-length": "1" }),
        ok: true,
        status: 200,
      };
    });

    await expect(
      mocks.handler?.(
        { sender: {} },
        { sourceUrl: "https://images.example.test/pinned.png", suggestedName: "pinned.png" },
      ),
    ).resolves.toEqual({ success: true, path: "/tmp/pinned.png" });
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });
});
