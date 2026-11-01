import { describe, expect, it } from "vitest";
import { createE2EStartupCredentialSeed } from "#e2e/helpers/e2e-startup-credentials";

const restoredOAuthCredentials = {
  "oauth:active_provider": "zai",
  "oauth:zai:access_token": "fake-access-token",
  "oauth:zai:user_info": "{}",
  cfjwttoken: "fake-cf-jwt",
};

describe("desktop e2e startup credentials", () => {
  it.each([
    undefined,
    [],
    ["./test/e2e/**/*.test.ts"],
    ["/repo/packages/desktop/test/e2e/new-unregistered-feature.test.ts"],
    ["C:\\repo\\packages\\desktop\\test\\e2e\\new-unregistered-feature.test.ts"],
    ["/repo/packages/desktop/test/e2e/browser-human-viewport-preference.test.ts"],
    ["/repo/packages/desktop/test/e2e/browser-permission-prompt.test.ts"],
  ])("Defaults to no account when account fixture is undeclared: %j", (specs) => {
    expect(
      createE2EStartupCredentialSeed({
        specs,
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }),
    ).toEqual({});
  });

  it("Explicit account mock preserves OAuth, does not auto-inject JWT, and does not modify inputs", () => {
    const fixture = Object.freeze({ ...restoredOAuthCredentials });
    expect(
      createE2EStartupCredentialSeed({
        specs: ["coding-plan-team-usage.test.ts"],
        accountMock: true,
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials: fixture,
      }),
    ).toEqual({
      auth_token: "fake-auth-token",
      "oauth:active_provider": "zai",
      "oauth:zai:access_token": "fake-access-token",
      "oauth:zai:user_info": "{}",
    });
    expect(fixture.cfjwttoken).toBe("fake-cf-jwt");
  });

  it("Remote replay prioritizes remaining anonymous without using local account mocks", () => {
    expect(
      createE2EStartupCredentialSeed({
        specs: ["provider-family-responsive.test.ts"],
        remoteProfile: true,
        accountMock: true,
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }),
    ).toEqual({});
  });
  it.each([
    "automations-custom-monthly-interval.test.ts",
    "automations-custom-yearly-schedule.test.ts",
    "automations-workflows-hub.test.ts",
  ])("Local automation spec %s does not seed fake accounts that block forms", (spec) => {
    expect(
      createE2EStartupCredentialSeed({
        specs: [`/repo/packages/desktop/test/e2e/${spec}`],
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }),
    ).toEqual({});
  });

  it("Sidebar close and restore does not seed fake account identities that block interactions", () => {
    expect(
      createE2EStartupCredentialSeed({
        specs: ["/repo/packages/desktop/test/e2e/manual-review/pending/side-pane-scope.test.ts"],
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }),
    ).toEqual({});
  });
  it("Personal Provider replay on remote runner does not seed fake identities that access the real control plane", () => {
    expect(
      createE2EStartupCredentialSeed({
        specs: ["conversation-session-r3-ack-loss.test.ts"],
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
        remoteProfile: true,
      }),
    ).toEqual({});
  });
  it.each([
    "conversation-session-r3-live-bigmodel-team.test.ts",
    "conversation-session-share-ssh-artifact.test.ts",
  ])("真实账号导入 spec %s 不混入默认假 OAuth 身份", (spec) => {
    expect(
      createE2EStartupCredentialSeed({
        specs: [
          `/repo/packages/desktop/test/e2e/conversation-session/manual-review/pending/${spec}`,
        ],
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }),
    ).toEqual({});
  });
  it.each([
    "conversation-session-offpeak-subagent-model-inheritance.test.ts",
    "conversation-session-off-peak-invalid-ticket.test.ts",
    "coding-plan-upgrade-webview-refresh-provider.test.ts",
    "marketing-touch-rewards.test.ts",
  ])("%s preserves JWT required for local Start balance/request authentication", (spec) => {
    expect(
      createE2EStartupCredentialSeed({
        specs: [spec],
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }).cfjwttoken,
    ).toBe("fake-cf-jwt");
  });
  it("Provider reactive spec preserves JWT required for local balance mock", () => {
    expect(
      createE2EStartupCredentialSeed({
        specs: ["/repo/packages/desktop/test/e2e/provider-family-responsive.test.ts"],
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }).cfjwttoken,
    ).toBe("fake-cf-jwt");
  });
  it("Pure Provider cold restore spec does not seed fake login state that accesses the account control plane", () => {
    expect(
      createE2EStartupCredentialSeed({
        specs: [
          "/repo/packages/desktop/test/e2e/conversation-session/manual-review/pending/conversation-session-unbound-resume.test.ts",
        ],
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }),
    ).toEqual({});
  });

  it.each([
    "conversation-session-preview-image-actions.test.ts",
    "conversation-session-v4-composer-toolbar.test.ts",
    "conversation-session-draft-model-switch-first-send.test.ts",
    "conversation-session-composer-draft-switching.test.ts",
    "conversation-session-ssh-provisioning-failure.test.ts",
    "conversation-session-local-conversation-identity.test.ts",
    "conversation-session-empty-completion-retry.test.ts",
    "command-center-focus.test.ts",
    "project-native-directory-picker.test.ts",
    "shortcut-settings-key-search.test.ts",
    "shortcut-settings-rebind.test.ts",
    "conversation-session-settings-connection-completion.test.ts",
    "conversation-session-project-device-selection.test.ts",
    "conversation-session-project-settings-return.test.ts",
    "conversation-session-background-connection.test.ts",
    "conversation-session-remote-project-handoff.test.ts",
    "conversation-session-web-remote-project-directory.test.ts",
    "conversation-session-web-remote-unread.test.ts",

    "conversation-session-existing-remote-project.test.ts",
    "conversation-session-chat-device-return.test.ts",
  ])("Local interaction spec %s does not seed unrelated account identities", (spec) => {
    expect(
      createE2EStartupCredentialSeed({
        specs: [`/repo/packages/desktop/test/e2e/conversation-session/${spec}`],
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }),
    ).toEqual({});
  });

  it.each([
    "conversation-session-automation-cron-create.test.ts",
    "conversation-session-fork-merged-assistant.test.ts",
    "conversation-session-goal-run-cases.test.ts",
    "conversation-session-running-guide-steer.test.ts",
    "conversation-session-tool-cross-product.test.ts",
    "conversation-session-assistant-preview-cards.test.ts",
    "conversation-session-v4-fork-edit-branch.test.ts",
  ])("fork/goal/tool spec %s does not seed unrelated account identities", (spec) => {
    expect(
      createE2EStartupCredentialSeed({
        specs: [`/repo/packages/desktop/test/e2e/conversation-session/${spec}`],
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }),
    ).toEqual({});
  });

  it("Regular session spec does not inject OAuth display state or JWT", () => {
    expect(
      createE2EStartupCredentialSeed({
        specs: [
          "/repo/packages/desktop/test/e2e/conversation-session/conversation-session-v4-sendnow.test.ts",
        ],
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }),
    ).toEqual({});
  });

  it("JWT 401 auto-logout dedicated spec preserves full restored OAuth fixture", () => {
    expect(
      createE2EStartupCredentialSeed({
        specs: [
          "/repo/packages/desktop/test/e2e/manual-review/pending/jwt-401-auto-logout.test.ts",
        ],
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }),
    ).toEqual({
      auth_token: "fake-auth-token",
      ...restoredOAuthCredentials,
    });
  });

  it("Start Plan manual claim spec preserves cf JWT required to call claim API", () => {
    expect(
      createE2EStartupCredentialSeed({
        specs: ["/repo/packages/desktop/test/e2e/ui-shell/marketing-touch-entitlement.test.ts"],
        legacyAuthToken: "fake-auth-token",
        restoredOAuthCredentials,
      }),
    ).toEqual({
      auth_token: "fake-auth-token",
      ...restoredOAuthCredentials,
    });
  });

  it("分享浮窗交互具备本地 mock 账号态", () => {
    expect(
      createE2EStartupCredentialSeed({
        specs: ["./test/e2e/conversation-session/conversation-session-share-popover.test.ts"],
        legacyAuthToken: "legacy",
        restoredOAuthCredentials: { cfjwttoken: "local-only" },
      }).cfjwttoken,
    ).toBe("local-only");
  });
});
