import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOnboardingRecordService } from "../../services/src/onboarding/onboardingRecordService.js";
import { getAppConfigDir, setDataBaseDir } from "../../services/src/paths.js";
import { seedRemoteOnboardingFixture } from "./e2e/helpers/remote-startup-profile.js";

const homes: string[] = [];
const fixtureUser = "cf-e2e-user";
const remoteSpec = "conversation-session-ssh-remote-connection-p0.test.ts";
const fixtureDeviceMid = "e2e-device-mid";

function createService(userId: string | null) {
  return createOnboardingRecordService({
    loadUserId: async () => userId,
    hasExistingLocalTask: async () => false,
  });
}

async function prepare(enabled: boolean, spec = remoteSpec) {
  const home = await mkdtemp(join(tmpdir(), "cf-remote-startup-"));
  homes.push(home);
  setDataBaseDir(home);
  await seedRemoteOnboardingFixture({
    enabled,
    specs: [spec],
    appConfigDir: getAppConfigDir(),
    userId: fixtureUser,
  });
}

afterEach(async () => {
  setDataBaseDir(null);
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("远程 E2E 的已完成引导前置", () => {
  it("Real recording service recognizes replay users and anonymous records; live login can claim anonymous records", async () => {
    await prepare(true);
    for (const userId of [fixtureUser, null]) {
      const service = createService(userId);
      expect(await service.shouldOnboard(fixtureDeviceMid)).toBe(false);
      expect(await service.syncSettingsFromRecord()).toMatchObject({
        memoryEnabled: false,
        proactiveSuggestionsEnabled: false,
      });
    }
    const live = createService("live-e2e-user");
    await live.claimAnonymousRecord();
    expect(await live.shouldOnboard(fixtureDeviceMid)).toBe(false);
    expect((await live.getRecords())?.entries.map((entry) => entry.userId)).toEqual([
      fixtureUser,
      "live-e2e-user",
    ]);
  });

  it("Do not change first-time onboarding for standard E2E", async () => {
    await prepare(false);
    const service = createService(fixtureUser);
    expect(await service.shouldOnboard(fixtureDeviceMid)).toBe(true);
  });

  it("Project navigation cases preserve the acceptance path of real completed onboarding and cold restart", async () => {
    await prepare(true, "conversation-session-rpn-project-navigation.test.ts");
    const service = createService(fixtureUser);
    expect(await service.shouldOnboard(fixtureDeviceMid)).toBe(true);
  });
});
