import { describe, expect, it } from "vitest";
import { shouldAutoScanOnboardingSessions } from "@/onboarding/OnboardingDialog.js";

describe("shouldAutoScanOnboardingSessions", () => {
  it("Automatically triggered when entering session step for the first time without prior scan", () => {
    expect(
      shouldAutoScanOnboardingSessions({
        view: "wizard",
        wizardStep: "session",
        supported: true,
        isScanning: false,
        candidateCount: 0,
        scanError: null,
        hasAutoScannedInCurrentEntry: false,
      }),
    ).toBe(true);
  });

  it("Empty result scenarios only auto-scan once within current step to prevent infinite rescan loops", () => {
    expect(
      shouldAutoScanOnboardingSessions({
        view: "wizard",
        wizardStep: "session",
        supported: true,
        isScanning: false,
        candidateCount: 0,
        scanError: null,
        hasAutoScannedInCurrentEntry: true,
      }),
    ).toBe(false);
  });

  it("Will not auto-scan again when results already exist", () => {
    expect(
      shouldAutoScanOnboardingSessions({
        view: "wizard",
        wizardStep: "session",
        supported: true,
        isScanning: false,
        candidateCount: 3,
        scanError: null,
        hasAutoScannedInCurrentEntry: false,
      }),
    ).toBe(false);
  });
});
