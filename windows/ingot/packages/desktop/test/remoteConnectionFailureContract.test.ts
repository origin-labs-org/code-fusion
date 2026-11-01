import { describe, expect, it } from "vitest";
import {
  hostRemoteWorkspaceConnectFailedResponseSchema,
  publicCfErrorCodeSchema,
  normalizeRemoteConnectionError,
} from "@origin-ai/cf-shared";

describe("连接失败的 Host/App 契约", () => {
  it("Public authentication codes carrying unknown causes are not overridden by the precheck phase", () => {
    const error = Object.assign(new Error("SSH 认证失败", { cause: new Error("opaque cause") }), {
      code: "remote-authentication-failed",
    });
    const failure = normalizeRemoteConnectionError(error, "preflight");
    expect(failure.code).toBe("remote-authentication-failed");
    expect(
      hostRemoteWorkspaceConnectFailedResponseSchema.safeParse({
        type: "remote-workspace-connect-failed",
        requestId: "auth",
        error: failure.message,
        reasonCode: failure.code,
      }).success,
    ).toBe(true);
  });
  it("The precheck phase does not preemptively claim unknown sub-errors, still allowing subsequent system errors to be found", () => {
    const error = new AggregateError(
      [
        new Error("opaque cause"),
        Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }),
      ],
      "Failed /Users/private/project",
    );
    expect(normalizeRemoteConnectionError(error, "preflight")).toMatchObject({
      code: "remote-host-unreachable",
      message: "Failed [redacted-path]",
    });
  });
  it("Stage wrapping preserves inner network classification, without treating stage codes as confirmed domain causes", () => {
    const error = Object.assign(
      new Error("probe failed", {
        cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
      }),
      { code: "remote-preflight-failed" },
    );
    expect(normalizeRemoteConnectionError(error, "preflight").code).toBe("remote-host-unreachable");
  });
  it.each([
    [
      new AggregateError([Object.assign(new Error(""), { code: "ECONNREFUSED" })]),
      "remote-host-unreachable",
    ],
    [Object.assign(new Error(""), { code: "ETIMEDOUT" }), "remote-connection-timeout"],
    [Object.assign(new Error(""), { code: "ENOTFOUND" }), "remote-host-not-found"],
    [new Error(""), "remote-connection-unknown"],
    [new Error("\u001b[31m"), "remote-connection-unknown"],
    [{ code: "private-code", message: "" }, "remote-connection-unknown"],
  ])("空消息和嵌套错误均可经过 Host schema 返回", (error, code) => {
    const result = normalizeRemoteConnectionError(error);
    expect(result.code).toBe(code);
    expect(result.message.trim()).not.toBe("");
    expect(publicCfErrorCodeSchema.parse(result.code)).toBe(code);
    expect(
      hostRemoteWorkspaceConnectFailedResponseSchema.safeParse({
        type: "remote-workspace-connect-failed",
        requestId: "request",
        error: result.message,
        reasonCode: result.code,
      }).success,
    ).toBe(true);
  });
  it.each([
    ["ENOSPC", "remote-space-insufficient"],
    ["EACCES", "remote-permission-denied"],
    ["ABORT_ERR", "remote-connection-canceled"],
    ["ERR_SSH_HOST_KEY_MISMATCH", "remote-host-key-changed"],
  ])("识别系统错误 %s", (code, expected) => {
    expect(normalizeRemoteConnectionError({ code, message: "failure" }).code).toBe(expected);
  });
  it("Socket interruptions during the probe phase are classified as network unreachable, not disguised as precheck failures", () => {
    const error = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
      syscall: "read",
    });
    expect(normalizeRemoteConnectionError(error, "preflight").code).toBe("remote-host-unreachable");
    expect(normalizeRemoteConnectionError(new Error("read ECONNRESET"), "preflight").code).toBe(
      "remote-host-unreachable",
    );
  });
  it.each(["download", "upload", "preflight", "install"])("%s failure preserves stage", (phase) => {
    expect(normalizeRemoteConnectionError(new Error("failed"), phase).code).toBe(
      `remote-${phase}-failed`,
    );
  });
});
