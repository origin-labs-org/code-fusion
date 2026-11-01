import { describe, expect, it } from "vitest";
import type { ModelCatalogEntry } from "@origin-ai/cf-contracts";
import {
  describeWorkflowSubagentModel,
  formatModelCatalogId,
  parseWorkflowSubagentModel,
  resolveModelReference,
} from "../src/tool/handlers/model-reference.js";

function entry(
  providerId: string,
  modelId: string,
  extra: Partial<ModelCatalogEntry> = {},
): ModelCatalogEntry {
  return { providerId, modelId, reasoningLevels: [], current: false, ...extra };
}

function expectOk(resolution: ReturnType<typeof resolveModelReference>) {
  expect(resolution.ok).toBe(true);
  if (!resolution.ok) throw new Error(`expected a resolution, got ${resolution.reason}`);
  return resolution;
}

function expectFailure(resolution: ReturnType<typeof resolveModelReference>) {
  expect(resolution.ok).toBe(false);
  if (resolution.ok) throw new Error("expected a failure");
  return resolution;
}

describe("resolveModelReference — 三档匹配", () => {
  it("第 1 档：全称精确命中，哪怕裸名在别处也唯一", () => {
    const entries = [entry("zhipu", "glm-4.6"), entry("openai", "glm-4.6")];
    const resolved = expectOk(resolveModelReference("openai/glm-4.6", entries));
    expect(resolved.canonical).toBe("openai/glm-4.6");
    expect(resolved.selection).toEqual({ providerId: "openai", modelId: "glm-4.6" });
    expect(resolved.entry).toBe(entries[1]);
  });

  it("Tier 2: Take the bare model name if it exists under the current session\'s provider", () => {
    const entries = [entry("zhipu", "glm-4.6", { current: true }), entry("zhipu", "glm-4.6-flash")];
    expect(expectOk(resolveModelReference("glm-4.6-flash", entries)).canonical).toBe(
      "zhipu/glm-4.6-flash",
    );
  });

  it("第 3 档：裸名只在别的 provider 下有 → other_provider，绝不悄悄跨账单", () => {
    const entries = [
      entry("team", "glm-5.3", { current: true }),
      entry("personal", "glm-5.3-flash"),
    ];
    const failed = expectFailure(resolveModelReference("glm-5.3-flash", entries));
    expect(failed.reason).toBe("other_provider");
    expect(failed.message).toContain("session's provider (team)");
    expect(failed.message).toContain("personal/glm-5.3-flash");
    expect(failed.message).toContain("ask the user first");
    expect(failed.candidates).toHaveLength(1);
  });

  it("全称照常跨 provider：那是用户点名时的写法", () => {
    const entries = [
      entry("team", "glm-5.3", { current: true }),
      entry("personal", "glm-5.3-flash"),
    ];
    expect(expectOk(resolveModelReference("personal/glm-5.3-flash", entries)).canonical).toBe(
      "personal/glm-5.3-flash",
    );
  });

  it("当前 provider 下的同名条目被禁用时，裸名同样不溜去别的 provider", () => {
    const entries = [
      entry("team", "glm-5.3", { current: true }),
      entry("team", "glm-5.3-flash", { disabledReason: "no key" }),
      entry("personal", "glm-5.3-flash"),
    ];
    expect(expectFailure(resolveModelReference("glm-5.3-flash", entries)).reason).toBe(
      "other_provider",
    );
  });

  it("目录里没有 current 条目时没有边界可守：裸名唯一就取", () => {
    const entries = [entry("zhipu", "glm-4.6"), entry("openai", "gpt-5")];
    expect(expectOk(resolveModelReference("gpt-5", entries)).canonical).toBe("openai/gpt-5");
  });

  it("第 2 档：裸名撞多个 provider 时，当前会话那一条胜出", () => {
    const entries = [
      entry("zhipu", "glm-4.6"),
      entry("bigmodel", "glm-4.6", { current: true }),
      entry("openrouter", "glm-4.6"),
    ];
    const resolved = expectOk(resolveModelReference("glm-4.6", entries));
    expect(resolved.canonical).toBe("bigmodel/glm-4.6");
  });

  it("No current item and bare name hits multiple providers: return \'ambiguous\' and list all conflicting full names", () => {
    const entries = [entry("zhipu", "glm-4.6"), entry("openrouter", "glm-4.6")];
    const failed = expectFailure(resolveModelReference("glm-4.6", entries));
    expect(failed.reason).toBe("ambiguous");
    expect(failed.message).toContain("zhipu/glm-4.6");
    expect(failed.message).toContain("openrouter/glm-4.6");
    expect(failed.message).toContain("providerId/modelId");
    expect(failed.candidates).toHaveLength(2);
  });

  it("3-tier comparison is case-insensitive, and the canonical form uses the registry\'s spelling", () => {
    const entries = [entry("BigModel", "GLM-4.6")];
    expect(expectOk(resolveModelReference("bigmodel/glm-4.6", entries)).canonical).toBe(
      "BigModel/GLM-4.6",
    );
    expect(expectOk(resolveModelReference("GLM-4.6", entries)).canonical).toBe("BigModel/GLM-4.6");
    expect(expectOk(resolveModelReference("  glm-4.6  ", entries)).canonical).toBe(
      "BigModel/GLM-4.6",
    );
  });
});

describe("resolveModelReference — 禁用条目", () => {
  it("Return \'disabled\' if only disabled entries match, and state the reason for each", () => {
    const entries = [entry("zhipu", "glm-4.6", { disabledReason: "no API key configured" })];
    const failed = expectFailure(resolveModelReference("glm-4.6", entries));
    expect(failed.reason).toBe("disabled");
    expect(failed.message).toContain("no API key configured");
    expect(failed.message).toContain("zhipu/glm-4.6");
    expect(failed.candidates).toEqual(entries);
  });

  it("禁用条目绝不参与第 3 档的歧义：同名的可用条目照常胜出", () => {
    const entries = [
      entry("zhipu", "glm-4.6", { disabledReason: "disabled by policy" }),
      entry("bigmodel", "glm-4.6"),
    ];
    expect(expectOk(resolveModelReference("glm-4.6", entries)).canonical).toBe("bigmodel/glm-4.6");
  });

  it("Do not include disabled entries in the \'not_found\' list: selecting an unusable name only leads to a second failure", () => {
    const entries = [
      entry("zhipu", "glm-4.6", { disabledReason: "no API key configured" }),
      entry("openai", "gpt-5"),
    ];
    const failed = expectFailure(resolveModelReference("claude-opus-5", entries));
    expect(failed.message).toContain("openai/gpt-5");
    expect(failed.message).not.toContain("zhipu/glm-4.6");
    expect(failed.candidates).toEqual([entries[1]]);
  });
});

describe("resolveModelReference — \'not_found\' message", () => {
  it("点名给的那个字符串、列出可用 id 并标出当前项，末尾给出 ListModels 这条路", () => {
    const entries = [entry("zhipu", "glm-4.6", { current: true }), entry("openai", "gpt-5")];
    const failed = expectFailure(resolveModelReference("gemini-3", entries));
    expect(failed.reason).toBe("not_found");
    expect(failed.message).toContain("`gemini-3`");
    expect(failed.message).toContain("zhipu/glm-4.6 [current]");
    expect(failed.message).toContain("openai/gpt-5");
    expect(failed.message).not.toContain("openai/gpt-5 [current]");
    expect(failed.message).toContain("Pass one of these ids, or call ListModels.");
  });

  it("State \'No models configured on this machine\' if the catalog is empty, rather than providing an empty list", () => {
    const failed = expectFailure(resolveModelReference("gpt-5", []));
    expect(failed.reason).toBe("not_found");
    expect(failed.message).toContain("No models are configured on this host.");
    expect(failed.candidates).toEqual([]);
  });

  it("清单封顶在 40 行，余下的换成一句可以拿到全量的话", () => {
    const entries = Array.from({ length: 60 }, (_, index) => entry("p", `m-${index}`));
    const failed = expectFailure(resolveModelReference("nope", entries));
    const listed = failed.message.split("\n").filter((line) => line.startsWith("p/m-"));
    expect(listed).toHaveLength(40);
    expect(failed.message).toContain("… and 20 more.");
    expect(failed.candidates).toHaveLength(60);
  });
});

describe("resolveModelReference — $reasoningLevel", () => {
  const LEVELED = entry("bigmodel", "glm-4.6", {
    reasoningLevels: ["low", "medium", "high"],
    defaultReasoningLevel: "high",
  });

  it("Include valid levels in selection and use the registry\'s spelling", () => {
    const resolved = expectOk(resolveModelReference("bigmodel/glm-4.6$LOW", [LEVELED]));
    expect(resolved.selection.options).toEqual({ reasoningLevel: "low" });
    expect(resolved.canonical).toBe("bigmodel/glm-4.6$low");
  });

  it("裸名加档位同样走第 2 档", () => {
    expect(expectOk(resolveModelReference("glm-4.6$medium", [LEVELED])).canonical).toBe(
      "bigmodel/glm-4.6$medium",
    );
  });

  it("Return \'reasoning_level_unknown\' if the level is unrecognized, and list the model\'s levels and default level", () => {
    const failed = expectFailure(resolveModelReference("glm-4.6$ultra", [LEVELED]));
    expect(failed.reason).toBe("reasoning_level_unknown");
    expect(failed.message).toContain("`ultra`");
    expect(failed.message).toContain("low, medium, high");
    expect(failed.message).toContain("Omit the suffix to use high.");
    expect(failed.candidates).toEqual([LEVELED]);
  });

  it("To没有档位的Model接 `  it( 时说清该Model根本没有档位", () => {
    const failed = expectFailure(resolveModelReference("gpt-5$high", [entry("openai", "gpt-5")]));
    expect(failed.reason).toBe("reasoning_level_unknown");
    expect(failed.message).toContain("has no reasoning levels");
  });

  it("不给档位时用注册表默认档", () => {
    expect(expectOk(resolveModelReference("glm-4.6", [LEVELED])).selection.options).toEqual({
      reasoningLevel: "high",
    });
  });

  it("模型没有档位时不造 options", () => {
    const resolved = expectOk(resolveModelReference("gpt-5", [entry("openai", "gpt-5")]));
    expect(resolved.selection.options).toBeUndefined();
    expect(resolved.canonical).toBe("openai/gpt-5");
  });

  it("有档位但注册表没给默认档时同样不造 options：没有可用的那一个就不猜", () => {
    const noDefault = entry("openai", "o5", { reasoningLevels: ["low", "high"] });
    expect(expectOk(resolveModelReference("o5", [noDefault])).selection.options).toBeUndefined();
  });
});

describe("规范形的读写", () => {
  it("describeWorkflowSubagentModel 只在设了模型时出现，并说明主代理没换", () => {
    expect(describeWorkflowSubagentModel(undefined)).toBe("");
    expect(describeWorkflowSubagentModel("bigmodel/glm-4.6$high")).toBe(
      " Subagents run on bigmodel/glm-4.6$high (the main agent stays on the session model).",
    );
  });

  it("parseWorkflowSubagentModel 把规范形拆回选型，缺席即缺席", () => {
    expect(parseWorkflowSubagentModel(undefined)).toBeUndefined();
    expect(parseWorkflowSubagentModel("bigmodel/glm-4.6$high")).toEqual({
      providerId: "bigmodel",
      modelId: "glm-4.6",
      options: { reasoningLevel: "high" },
    });
  });

  it("parseWorkflowSubagentModel alerts on non-normalized strings instead of silently dropping the user\'s requested model", () => {
    expect(() => parseWorkflowSubagentModel("glm-4.6")).toThrow(/un-canonicalised/u);
  });

  it("formatModelCatalogId 不带档位：id 是可以逐字抄进 subagent_model 的那一半", () => {
    expect(formatModelCatalogId(entry("bigmodel", "glm-4.6", { reasoningLevels: ["high"] }))).toBe(
      "bigmodel/glm-4.6",
    );
  });
});
