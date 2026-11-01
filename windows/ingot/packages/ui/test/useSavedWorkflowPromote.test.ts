// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandAck, CommandEnvelope } from "@origin-ai/cf-shared/cf-protocol-v4";

const sendCommand = vi.fn<[CommandEnvelope], Promise<CommandAck>>();
const release = vi.fn();
const acquireWorkspaceConnection = vi.fn(() => ({
  transport: { sendCommand },
  layer: {},
  activateRemoteService: () => {},
  release,
}));
vi.mock("@/v4/workspaceConnectionRegistry.js", () => ({
  acquireWorkspaceConnection: (...args: unknown[]) =>
    (acquireWorkspaceConnection as (...a: unknown[]) => unknown)(...args),
  LOCAL_WORKSPACE_CONNECTION_ENDPOINT: "__base__",
}));

const { useSavedWorkflowPromote } =
  await import("@/settings/saved-workflows/useSavedWorkflowPromote.js");

function ack(partial: Partial<CommandAck>): CommandAck {
  return { commandId: "c", status: "accepted", revisionAtDecision: 0, ...partial };
}

const agentService = {} as never;
const REQUEST = {
  name: "release-check",
  path: "/beta/.cf/workflows/release-check.dwf.ts",
  locale: "zh-CN",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSavedWorkflowPromote", () => {
  it("accepted：One条 createSession，payload 带 workspaceId 与 firstInput 概括Notice；导航并Back sessionId", async () => {
    sendCommand.mockResolvedValueOnce(
      ack({ result: { type: "createSession", sessionId: "s-1" } as never }),
    );
    const onNavigate = vi.fn();
    const { result } = renderHook(() => useSavedWorkflowPromote({ agentService, onNavigate }));

    let promoted: Awaited<ReturnType<typeof result.current.promote>> | undefined;
    await act(async () => {
      promoted = await result.current.promote({ workspacePath: "/beta" }, REQUEST);
    });

    expect(sendCommand).toHaveBeenCalledTimes(1);
    const envelope = sendCommand.mock.calls[0]![0];
    expect(envelope.type).toBe("createSession");
    expect(envelope.sessionId).toBeNull();
    const payload = envelope.payload as { workspaceId: string; firstInput: { text: string } };
    expect(payload.workspaceId).toBe("/beta");
    expect(payload.firstInput.text).toContain("「release-check」");
    expect(payload.firstInput.text).toContain("/beta/.cf/workflows/release-check.dwf.ts");
    expect(payload.firstInput.text).toContain('scope: "global"');
    expect(Object.keys(payload)).toEqual(["workspaceId", "firstInput"]);

    expect(onNavigate).toHaveBeenCalledWith({ workspacePath: "/beta" }, "s-1");
    expect(promoted).toEqual({ ok: true, sessionId: "s-1" });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("workspaceId 取 identity 优先；租About带 remoteSessionId 口径", async () => {
    sendCommand.mockResolvedValueOnce(
      ack({ result: { type: "createSession", sessionId: "s-2" } as never }),
    );
    const { result } = renderHook(() => useSavedWorkflowPromote({ agentService }));
    await act(async () => {
      await result.current.promote(
        { workspacePath: "/beta", workspaceIdentity: "remote:dev:/beta", remoteSessionId: "r" },
        { ...REQUEST, locale: "en-US" },
      );
    });
    const payload = sendCommand.mock.calls[0]![0].payload as {
      workspaceId: string;
      firstInput: { text: string };
    };
    expect(payload.workspaceId).toBe("remote:dev:/beta");
    expect(payload.firstInput.text).toContain('"release-check"');
    expect(acquireWorkspaceConnection).toHaveBeenCalledWith(
      { workspacePath: "/beta", workspaceIdentity: "remote:dev:/beta", remoteSessionId: "r" },
      agentService,
    );
  });

  it("createSession 被拒：不导航，Back code + message；不发任何回收Command", async () => {
    sendCommand.mockResolvedValueOnce(
      ack({ status: "rejected", reasonCode: "fault.command.workspaceReadOnly", message: "ro" }),
    );
    const onNavigate = vi.fn();
    const { result } = renderHook(() => useSavedWorkflowPromote({ agentService, onNavigate }));
    let promoted: Awaited<ReturnType<typeof result.current.promote>> | undefined;
    await act(async () => {
      promoted = await result.current.promote({ workspacePath: "/beta" }, REQUEST);
    });
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(promoted).toEqual({
      ok: false,
      code: "fault.command.workspaceReadOnly",
      message: "ro",
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("transport Throw error：Back exception Error并释放租About", async () => {
    sendCommand.mockRejectedValueOnce(new Error("socket closed"));
    const { result } = renderHook(() => useSavedWorkflowPromote({ agentService }));
    let promoted: Awaited<ReturnType<typeof result.current.promote>> | undefined;
    await act(async () => {
      promoted = await result.current.promote({ workspacePath: "/beta" }, REQUEST);
    });
    expect(promoted).toEqual({ ok: false, code: "exception", message: "socket closed" });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("同One帧inner重复调用：Second time立即回 promote_in_flight，不再发Command", async () => {
    let resolveFirst: ((ack: CommandAck) => void) | undefined;
    sendCommand.mockImplementationOnce(
      () =>
        new Promise<CommandAck>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = renderHook(() => useSavedWorkflowPromote({ agentService }));
    let first: Promise<Awaited<ReturnType<typeof result.current.promote>>> | undefined;
    let second: Awaited<ReturnType<typeof result.current.promote>> | undefined;
    await act(async () => {
      first = result.current.promote({ workspacePath: "/beta" }, REQUEST);
      second = await result.current.promote({ workspacePath: "/beta" }, REQUEST);
    });
    expect(second).toEqual({ ok: false, code: "promote_in_flight" });
    expect(sendCommand).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst?.(ack({ result: { type: "createSession", sessionId: "s-5" } as never }));
      await first;
    });
    expect(result.current.pending).toBe(false);
  });
});
