import { describe, expect, it } from "vitest";
import {
  buildLoginApiKeyDefaultModelPreferenceFromSelection,
  buildLoginApiKeySkipSettings,
  resolveLoginApiKeyDefaultProvider,
  resolveHydratedLoginApiKeyValue,
  resolveLoginApiKeyTemplateId,
  shouldShowLoginApiKeyLink,
} from "@/login/LoginApiKeyForm.helpers.js";
import { encodeCustomModelValue } from "@/lib/cfCustomModelValue.js";

describe("LoginApiKeyForm provider update helpers", () => {
  it("Determine API key provider default solely by App\'s resolved language", () => {
    expect(resolveLoginApiKeyDefaultProvider("zh-CN")).toBe("bigmodel");
    expect(resolveLoginApiKeyDefaultProvider("en-US")).toBe("zai");
  });

  it("Write corresponding built-in provider id based on provider selection in modal", () => {
    expect(resolveLoginApiKeyTemplateId("zai")).toBe("zai-api");
    expect(resolveLoginApiKeyTemplateId("bigmodel")).toBe("bigmodel-api");
  });

  it("跳过 API key 时只写入当前 provider family domain", () => {
    expect(buildLoginApiKeySkipSettings("bigmodel", 300)).toEqual({
      providerFamilyDomain: "bigmodel",
      providerFamilyDomainUpdatedAt: 300,
      providerFamilyDomainMigrated: true,
    });
  });

  it("Only show \'Get API key\' link when input is empty and provider has a URL", () => {
    expect(shouldShowLoginApiKeyLink("", "https://z.ai/manage-apikey/apikey-list")).toBe(true);
    expect(shouldShowLoginApiKeyLink(" sk-login ", "https://z.ai/manage-apikey/apikey-list")).toBe(
      false,
    );
    expect(shouldShowLoginApiKeyLink("", undefined)).toBe(false);
  });

  it("新 Provider Runtime 从 Selection View 选择 API key 登录后的默认模型", () => {
    expect(
      buildLoginApiKeyDefaultModelPreferenceFromSelection(
        {
          revision: 3,
          providers: [
            {
              providerId: "bigmodel-api",
              config: {
                kind: "api",
                models: ["glm-5.3", "glm-5.2"],
              },
              models: [
                { modelId: "glm-5.3", config: {} },
                { modelId: "glm-5.2", config: {} },
              ],
            },
          ],
        },
        "bigmodel-api",
      ),
    ).toBe(encodeCustomModelValue("bigmodel-api", "glm-5.3"));
  });

  it("Autofill saved API key only when user has not edited the input", () => {
    expect(
      resolveHydratedLoginApiKeyValue({
        savedApiKey: " sk-saved ",
        userEdited: false,
      }),
    ).toBe("sk-saved");
    expect(
      resolveHydratedLoginApiKeyValue({
        savedApiKey: "sk-saved",
        userEdited: true,
      }),
    ).toBeNull();
  });
});
