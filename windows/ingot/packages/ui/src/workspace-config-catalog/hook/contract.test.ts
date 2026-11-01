// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { IServiceAccessor } from "../contract.js";
import { registerSourceSettingsServices } from "@/store/sourceSettingsServiceStore.js";
import { useConfigWorkspaceServicesResolution } from "../index.js";
const state = vi.hoisted(() => ({
  mobile: false,
  request: vi.fn(async () => ({ attachmentId: "config" })),
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServicesResolution: () => ({
    services: {},
    remoteSessionId: null,
    isRemoteTarget: true,
    connectionKind: "remote-waiting",
    rpcReady: false,
  }),
}));
const platform = { requestSourceSettingsAttachment: state.request };
vi.mock("@/hooks/usePlatform.js", () => ({
  useOptionalPlatform: () => (state.mobile ? null : platform),
}));
afterEach(() => {
  cleanup();
  state.mobile = false;
  state.request.mockClear();
});
it("Tabless config must complete remote canonical binding first; incomplete or stale results are not writable", async () => {
  let finish!: () => void;
  const resolveWorkspace = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const services = {
    sourceServerWorkspaceService: { resolveWorkspace },
  } as unknown as IServiceAccessor;
  const release = registerSourceSettingsServices({
    sourceServerId: "config-owner",
    attachmentId: "config",
    services,
    dispose: vi.fn(),
  });
  try {
    const { result, rerender } = renderHook(
      ({ path }) =>
        useConfigWorkspaceServicesResolution(path, undefined, `remote:server:config-owner:${path}`),
      { initialProps: { path: "/root-a" } },
    );
    expect(result.current.rpcReady).toBe(false);
    await waitFor(() =>
      expect(resolveWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: "/root-a" }),
      ),
    );
    const first = finish;
    rerender({ path: "/root-b" });
    await waitFor(() => expect(resolveWorkspace).toHaveBeenCalledTimes(2));
    await act(async () => first());
    expect(result.current.rpcReady).toBe(false);
    await act(async () => finish());
    expect(result.current.rpcReady).toBe(true);
    expect(result.current.services).toBe(services);
    act(release);
    expect(result.current.rpcReady).toBe(false);
  } finally {
    release();
  }
});
it("Mobile cannot obtain desktop Source settings attachment via config directory reads", () => {
  state.mobile = true;
  const release = registerSourceSettingsServices({
    sourceServerId: "mobile-owner",
    attachmentId: "desktop-only",
    services: {} as IServiceAccessor,
    dispose: vi.fn(),
  });
  try {
    const { result } = renderHook(() =>
      useConfigWorkspaceServicesResolution("/repo", undefined, "remote:server:mobile-owner:/repo"),
    );
    expect(result.current.rpcReady).toBe(false);
    expect(state.request).not.toHaveBeenCalled();
  } finally {
    release();
  }
});
