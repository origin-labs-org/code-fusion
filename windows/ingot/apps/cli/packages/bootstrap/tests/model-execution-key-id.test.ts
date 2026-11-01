import { describe, expect, it } from "vitest";
import { cfSessionSendParamsSchema } from "@origin-ai/cf-shared";
import { createModelExecutionContext } from "../src/cf-protocol/model-execution.js";

describe("请求期 Key ID 执行上下文", () => {
  it("协议与冻结投影保留真实 ID，不将其加入模型 Header", async () => {
    const requestAuth = { apiKey: "pat", apiKeyId: "real-key-id", accountScope: "a".repeat(64) };
    const execution = createModelExecutionContext(
      cfSessionSendParamsSchema.shape.modelExecution
        .unwrap()
        .parse({ selectionScope: "execution", requestAuth }),
    );
    const value = await execution.requestDependencies?.requestAuth?.source?.resolve({
      attempt: 1,
      providerId: "account:bigmodel-off-peak",
      modelId: "glm",
    });
    expect(value).toEqual(requestAuth);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("原样透传 selectionFallback 声明，包括发起方声明的退回目标", () => {
    const selectionFallback = {
      providerId: "account:bigmodel-highspeed-card",
      rules: [
        { reason: "highspeed_card_expired" as const, providerErrorCode: "3402" },
        { reason: "highspeed_request_failed" as const },
      ],
      target: {
        providerId: "account:bigmodel-team-coding-plan",
        modelId: "GLM-5.3",
        options: { reasoningLevel: "low" },
      },
    };
    const execution = createModelExecutionContext(
      cfSessionSendParamsSchema.shape.modelExecution
        .unwrap()
        .parse({ selectionScope: "execution", selectionFallback }),
    );
    expect(execution.selectionFallback).toEqual(selectionFallback);
  });
});
