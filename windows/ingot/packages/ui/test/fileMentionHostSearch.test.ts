// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { WorkspaceFileEntry } from "@origin-ai/cf-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileMentionProvider } from "@/mentions/providers/fileMentionProvider.js";

const mocks = vi.hoisted(() => ({
  service: {
    searchWorkspaceFiles: vi.fn(),
    listWorkspaceFilesLength: vi.fn(),
    listWorkspaceFilesRange: vi.fn(),
  },
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServicesResolution: () => ({
    services: {
      fileService: mocks.service,
      broadcastService: { onMessage: () => ({ dispose() {} }) },
    },
  }),
}));

const entry = (name: string): WorkspaceFileEntry => ({
  name,
  path: `/repo/${name}`,
  relativePath: name,
  type: "file",
});
const initial = { query: "", enabled: true, identity: "host-a", path: "/repo" };
const initialService = mocks.service;
const renderProvider = () =>
  renderHook(
    (props) =>
      useFileMentionProvider(
        props.path,
        props.identity,
        props.query,
        props.enabled,
        "empty",
        "files",
        10,
      ),
    { initialProps: initial },
  );
function deferred() {
  let resolve!: (value: WorkspaceFileEntry[]) => void;
  const promise = new Promise<WorkspaceFileEntry[]>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  mocks.service = initialService;
  vi.clearAllMocks();
  mocks.service.searchWorkspaceFiles.mockReset().mockResolvedValue([entry("Main.ts")]);
});
afterEach(cleanup);

describe("@ file candidates use Host search", () => {
  it("Connection change with same path and identity does not reuse stale results", async () => {
    const hook = renderProvider();
    await waitFor(() => expect(hook.result.current.items[0]?.label).toBe("Main.ts"));
    const pending = deferred();
    mocks.service = {
      ...mocks.service,
      searchWorkspaceFiles: vi.fn().mockReturnValue(pending.promise),
    };
    hook.rerender(initial);
    expect(hook.result.current.items).toEqual([]);
    await act(async () => pending.resolve([entry("reconnected.ts")]));
    expect(hook.result.current.items[0]?.label).toBe("reconnected.ts");
  });

  it("Older requests cannot overwrite newer results when only keywords change", async () => {
    const pending = deferred();
    mocks.service.searchWorkspaceFiles.mockReturnValueOnce(pending.promise);
    const hook = renderProvider();
    await waitFor(() => expect(mocks.service.searchWorkspaceFiles).toHaveBeenCalledOnce());
    hook.rerender({ ...initial, query: "Main" });
    await waitFor(() => expect(hook.result.current.items[0]?.label).toBe("Main.ts"));
    await act(async () => pending.resolve([entry("old.ts")]));
    expect(hook.result.current.items[0]?.label).toBe("Main.ts");
  });
  it("只请求有界候选，不拉取完整索引，保留 mention 内容", async () => {
    const hook = renderProvider();
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    expect(mocks.service.searchWorkspaceFiles).toHaveBeenCalledWith({
      rootPath: "/repo",
      workspaceIdentity: "host-a",
      query: "",
      limit: 10,
    });
    expect(mocks.service.listWorkspaceFilesLength).not.toHaveBeenCalled();
    expect(mocks.service.listWorkspaceFilesRange).not.toHaveBeenCalled();
    expect(hook.result.current.items[0]?.markdown).toBe("[Main.ts](./Main.ts)");
  });

  it("Discard late results for stale keywords and outdated workspaces", async () => {
    const first = deferred();
    const second = deferred();
    mocks.service.searchWorkspaceFiles
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const hook = renderProvider();
    await waitFor(() => expect(mocks.service.searchWorkspaceFiles).toHaveBeenCalledOnce());
    hook.rerender({ ...initial, query: "next", identity: "host-b" });
    expect(hook.result.current.items).toEqual([]);
    await act(async () => second.resolve([entry("next.ts")]));
    await waitFor(() => expect(hook.result.current.items[0]?.label).toBe("next.ts"));
    await act(async () => first.resolve([entry("old.ts")]));
    expect(hook.result.current.items[0]?.label).toBe("next.ts");
  });

  it("Rescan at most once on no match, stop requesting on refresh failure", async () => {
    mocks.service.searchWorkspaceFiles.mockResolvedValueOnce([]);
    const hook = renderProvider();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    mocks.service.searchWorkspaceFiles
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("offline"));
    hook.rerender({ ...initial, query: "new-file" });
    await waitFor(() => expect(hook.result.current.error?.message).toBe("offline"));
    expect(mocks.service.searchWorkspaceFiles.mock.calls.at(-1)?.[0].refresh).toBe(true);
    const count = mocks.service.searchWorkspaceFiles.mock.calls.length;
    hook.rerender({ ...initial, query: "another-query" });
    await act(async () => {});
    expect(mocks.service.searchWorkspaceFiles).toHaveBeenCalledTimes(count);
    expect(hook.result.current.loading).toBe(false);
  });

  it("Closing panel invalidates in-flight results; reopening can recover error", async () => {
    const pending = deferred();
    mocks.service.searchWorkspaceFiles.mockReturnValueOnce(pending.promise);
    const hook = renderProvider();
    await waitFor(() => expect(mocks.service.searchWorkspaceFiles).toHaveBeenCalledOnce());
    hook.rerender({ ...initial, enabled: false });
    await act(async () => pending.resolve([entry("old.ts")]));
    expect(hook.result.current.items).toEqual([]);
    mocks.service.searchWorkspaceFiles.mockRejectedValueOnce(new Error("offline"));
    hook.rerender(initial);
    await waitFor(() => expect(hook.result.current.error?.message).toBe("offline"));
    hook.rerender({ ...initial, enabled: false });
    hook.rerender(initial);
    await waitFor(() => expect(hook.result.current.items[0]?.label).toBe("Main.ts"));
  });
});
