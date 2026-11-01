import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseModelConfig, parseCfBuiltinModelConfigRules } from "@origin-ai/cf-provider";

describe("MCS published capability boundaries", () => {
  it("supports known Claude models across sites, without granting Sonnet or a different API", async () => {
    const release = JSON.parse(
      await readFile(
        new URL("../../../config/provider/cf-builtin.json", import.meta.url),
        "utf8",
      ),
    );
    const rules = parseCfBuiltinModelConfigRules(release.config.modelConfigRules);
    for (const baseUrl of ["https://api.anthropic.com/v1", "https://proxy.example/v1"]) {
      for (const modelId of [
        "claude-opus-4-8",
        "anthropic/claude-opus-4.8",
        "gateway/claude-opus-4-8:free",
        "claude-opus-5",
        "claude-fable-5",
        "claude-fable-5-1",
        "claude-mythos-5-1",
        "claude-sonnet-5",
        "claude-sonnet-4-6",
        "claude-unknown",
      ]) {
        const config = rules.resolve({
          providerId: "fixture",
          modelId,
          baseUrl,
          apiType: "anthropic-messages",
        });
        const expected = !modelId.includes("sonnet") && !modelId.includes("unknown");
        expect(config.properties?.supportsMidConversationSystem, `${baseUrl}/${modelId}`).toBe(
          expected,
        );
        expect(
          config.overlay(parseModelConfig({ properties: { supportsMidConversationSystem: false } }))
            .properties?.supportsMidConversationSystem,
        ).toBe(false);
        expect(
          rules.resolve({
            providerId: "fixture",
            modelId,
            baseUrl,
            apiType: "openai-chat-completions",
          }).properties?.supportsMidConversationSystem,
        ).toBe(false);
      }
    }
    for (const provider of release.config.providerConfigRules.providerRules) {
      const { api } = provider.config;
      const config = rules.resolve({
        providerId: provider.providerId,
        modelId: "GLM-5.3-Flash",
        apiType: api.type,
        baseUrl: api.baseUrl,
      });
      expect(config.properties?.supportsMidConversationSystem, provider.providerId).toBe(true);
      expect(config.properties?.supportsNativeWebSearch, provider.providerId).toBe(
        provider.config.access.mode !== "off-peak",
      );
    }
    for (const baseUrl of [
      "https://cf.z.ai/api/v1/off-peak/anthropic/",
      "https://cf.z.ai/api/v1/cf-plan/anthropic/",
    ]) {
      expect(
        rules.resolve({
          providerId: "fixture",
          modelId: "unknown",
          apiType: "anthropic-messages",
          baseUrl,
        }).properties?.supportsMidConversationSystem,
      ).toBe(true);
      for (const negative of [
        `${baseUrl}extra`,
        baseUrl.replace("cf.z.ai", "cf.z.ai.evil.example"),
      ]) {
        expect(
          rules.resolve({
            providerId: "fixture",
            modelId: "unknown",
            apiType: "anthropic-messages",
            baseUrl: negative,
          }).properties?.supportsMidConversationSystem,
        ).toBe(false);
      }
    }
  });
});
