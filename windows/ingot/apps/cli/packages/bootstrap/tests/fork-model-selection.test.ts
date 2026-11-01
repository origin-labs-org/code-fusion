import { describe, expect, it } from "vitest";
import { HIGHSPEED_PROVIDER_IDS } from "@origin-ai/cf-shared";
import {
  cloneModelSelection,
  derivedSessionModelSelection,
  modelSelectionWithOptionFallback,
} from "../src/cf-protocol/fork-model-selection.js";

const sessionSelection = {
  providerId: "builtin:zai-coding-plan",
  modelId: "glm-4.6",
  options: { reasoningLevel: "high" },
};

describe("Derived session\'s resident Selection", () => {
  it("Fallback to parent session\'s resident Selection when branch point is accelerated turn, without inheriting accelerated Provider", () => {
    for (const providerId of Object.values(HIGHSPEED_PROVIDER_IDS)) {
      const derived = derivedSessionModelSelection(
        { providerId, modelId: "glm-5", options: { reasoningLevel: "max" } },
        sessionSelection,
      );

      expect(derived).toEqual(sessionSelection);
      expect(derived).not.toBe(sessionSelection);
    }
  });

  it("父会话也没有常驻 Selection 时宁可留空，也不把加速 Provider 写进 child", () => {
    expect(
      derivedSessionModelSelection(
        { providerId: HIGHSPEED_PROVIDER_IDS.zai, modelId: "glm-5" },
        undefined,
      ),
    ).toBeUndefined();
  });

  it("普通分叉点继承消息选型，缺失推理档位时回落会话档位", () => {
    expect(
      derivedSessionModelSelection(
        { providerId: "provider-a", modelId: "model-a", options: { reasoningLevel: "low" } },
        sessionSelection,
      ),
    ).toEqual({
      providerId: "provider-a",
      modelId: "model-a",
      options: { reasoningLevel: "low" },
    });
    expect(
      derivedSessionModelSelection(
        { providerId: "provider-a", modelId: "model-a" },
        sessionSelection,
      ),
    ).toEqual({
      providerId: "provider-a",
      modelId: "model-a",
      options: { reasoningLevel: "high" },
    });
  });

  it("Derives from session\'s resident Selection when branch point message lacks selection fact", () => {
    expect(derivedSessionModelSelection(undefined, sessionSelection)).toEqual(sessionSelection);
    expect(derivedSessionModelSelection(undefined, undefined)).toBeUndefined();
  });
});

describe("Selection 复制原语", () => {
  it("cloneModelSelection 不与源共享 options 引用", () => {
    const cloned = cloneModelSelection(sessionSelection);
    expect(cloned).toEqual(sessionSelection);
    expect(cloned?.options).not.toBe(sessionSelection.options);
    expect(cloneModelSelection(undefined)).toBeUndefined();
  });

  it("modelSelectionWithOptionFallback 无回落值时保留请求的模型身份", () => {
    expect(modelSelectionWithOptionFallback({ providerId: "p", modelId: "m" }, undefined)).toEqual({
      providerId: "p",
      modelId: "m",
    });
  });
});
