import { describe, expect, it } from "vitest";
import { createComputerUseRuntime } from "../index.js";
import { callBrokerMethod } from "../broker.js";

describe("Computer Use placeholder", () => {
  it("Execution entry explicitly reports unavailable and does not trigger actual broker preparation.", async () => {
    let prepared = false;
    const runtime = createComputerUseRuntime({
      ensureBrokerAvailable: async () => {
        prepared = true;
      },
    });
    await expect(
      runtime.execute({
        toolName: "computer_use",
        arguments: {},
        context: { sessionId: "example", runtimeScope: "main", workspaceKey: "example" },
      }),
    ).resolves.toMatchObject({ isError: true });
    expect(prepared).toBe(false);
    await runtime.dispose();
  });

  it("broker 方法拒绝执行真实系统能力", async () => {
    await expect(
      callBrokerMethod({ method: "example", socketPath: "unused" }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
