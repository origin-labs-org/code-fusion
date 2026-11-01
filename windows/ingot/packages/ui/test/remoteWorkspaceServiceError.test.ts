import { describe, expect, it } from "vitest";
import {
  isRemoteWorkspaceDisconnectedError,
  REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE,
} from "@/lib/remoteWorkspaceServiceError.js";

describe("remoteWorkspaceServiceError", () => {
  it("识别本地 Error 和 RPC 序列化后的远端断连错误", () => {
    expect(
      isRemoteWorkspaceDisconnectedError(
        Object.assign(new Error(REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE), {
          code: REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE,
        }),
      ),
    ).toBe(true);
    expect(
      isRemoteWorkspaceDisconnectedError({
        code: REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE,
      }),
    ).toBe(true);
    expect(
      isRemoteWorkspaceDisconnectedError({
        message: REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE,
      }),
    ).toBe(true);
    expect(isRemoteWorkspaceDisconnectedError(REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE)).toBe(true);
  });

  it("Do not swallow normal RPC and business errors", () => {
    expect(isRemoteWorkspaceDisconnectedError(new Error("RPC channel closed"))).toBe(false);
    expect(
      isRemoteWorkspaceDisconnectedError({
        code: "EACCES",
        message: `wrapped ${REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE}`,
      }),
    ).toBe(false);
  });
});

it("Send race conditions use remote connection classification; model\'s own connection errors are not misclassified", async () => {
  const { getRemoteConnectionFailureCode } = await import("@/lib/remoteWorkspaceServiceError.js");
  expect(getRemoteConnectionFailureCode({ code: REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE })).toBe(
    REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE,
  );
  expect(
    getRemoteConnectionFailureCode({ code: "remote-host-unreachable", message: "timeout" }),
  ).toBe("remote-host-unreachable");
  expect(getRemoteConnectionFailureCode(new Error("RPC channel closed"))).toBeUndefined();
  expect(
    getRemoteConnectionFailureCode({ code: "MODEL_ERROR", message: "Connection error" }),
  ).toBeUndefined();
});
