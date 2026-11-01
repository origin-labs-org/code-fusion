import { expect, it } from "vitest";
import { createE2EStartupCredentialSeed } from "./e2e/helpers/e2e-startup-credentials.js";

it.each([
  "plugin-management-discovery-presentation.test.ts",
  "plugin-management-ui-market.test.ts",
  "conversation-session-plugin-marketplace-installed-roundtrip.test.ts",
  "plugin-store-auto-refresh-throttled.test.ts",
  "plugin-store-auto-refresh-on-enter.test.ts",
])("Plugin marketplace replay %s does not inject identity invalid on real account control plane", (spec) => {
  expect(
    createE2EStartupCredentialSeed({
      specs: [spec],
      legacyAuthToken: "fake-auth-token",
      restoredOAuthCredentials: {
        "oauth:active_provider": "zai",
        "oauth:zai:access_token": "fake-access-token",
        "oauth:zai:user_info": "{}",
        cfjwttoken: "fake-cf-jwt",
      },
    }),
  ).toEqual({});
});
