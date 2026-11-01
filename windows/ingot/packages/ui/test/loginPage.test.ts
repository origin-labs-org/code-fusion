import { describe, expect, it } from "vitest";

describe("WelcomeScreen", () => {
  it("Existing user will not complete newly initiated Provider login attempt", async () => {
    const { shouldCompleteLoginFromExistingUser, shouldCompleteProviderLoginAttempt } =
      await import("@/WelcomeScreen.js");
    const attempt = { id: 9, providerId: "bigmodel" as const };

    expect(shouldCompleteLoginFromExistingUser({ hasUser: true, attempt })).toBe(false);
    expect(shouldCompleteProviderLoginAttempt({ attempt, successProvider: "zai" })).toBe(false);
    expect(shouldCompleteProviderLoginAttempt({ attempt, successProvider: "bigmodel" })).toBe(true);
  });
});
