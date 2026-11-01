import { describe, expect, it } from "vitest";
import { resolveRpcLogLevel } from "../src/host/rpcLogLevel.js";

describe("host RPC 日志级别映射", () => {
  it("Log successful background Bash polls as debug only, but log failures as warn", () => {
    expect(resolveRpcLogLevel("[rpc:call] cf-agent.backgroundBashOutputV4 OK (1.5ms)")).toBe(
      "debug",
    );
    expect(resolveRpcLogLevel("[rpc:call] cf-agent.backgroundBashOutputV4 FAIL (1.5ms)")).toBe(
      "warn",
    );
    expect(
      resolveRpcLogLevel("[rpc:call] cf-agent.otherBackgroundBashOutputV4 OK (1.5ms)"),
    ).toBe("info");
  });

  it("RPC success logs should be logged as info", () => {
    expect(resolveRpcLogLevel("[rpc:call] setting.get OK (1.5ms)")).toBe("info");
  });

  it("RPC failure logs should be logged as warn", () => {
    expect(resolveRpcLogLevel("[rpc:call] setting.get FAIL (1.5ms)")).toBe("warn");
  });

  it("Runtime identity queries before provider registry is ready should be logged as info", () => {
    const error = Object.assign(new Error("provider not ready"), {
      code: "CF_AGENT_PROVIDER_NOT_READY",
    });

    expect(
      resolveRpcLogLevel(
        "[rpc:call] cf-session.getWorkspaceRuntimeIdentity FAIL (12.0ms)",
        error,
      ),
    ).toBe("info");
  });
});
