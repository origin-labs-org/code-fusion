import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { onboardingRecordFileSchema } from "@origin-ai/cf-shared";

export async function seedRemoteOnboardingFixture(options: {
  enabled: boolean;
  specs: readonly string[];
  appConfigDir: string;
  userId: string;
}): Promise<void> {
  if (
    !options.enabled ||
    options.specs.some((spec) =>
      spec.endsWith("conversation-session-rpn-project-navigation.test.ts"),
    )
  )
    return;

  const record = onboardingRecordFileSchema.parse({
    version: 1,
    deviceMid: "cf-remote-e2e-device",
    entries: [options.userId, null].map((userId) => ({
      userId,
      occupation: "developer",
      interfaceMode: "coding",
      memoryEnabled: false,
      proactiveSuggestionsEnabled: false,
      completedAt: new Date().toISOString(),
      uploadState: "pending",
    })),
  });
  await mkdir(options.appConfigDir, { recursive: true });
  await writeFile(
    join(options.appConfigDir, "onboarding-record.json"),
    JSON.stringify(record, null, 2),
  );
  const settingsPath = join(options.appConfigDir, "setting.json");
  const settings = await readFile(settingsPath, "utf8").then(
    (contents) => JSON.parse(contents),
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return {};
    },
  );
  await writeFile(
    settingsPath,
    JSON.stringify(
      {
        ...settings,
        onboardingOccupation: "developer",
        memoryEnabled: false,
        proactiveSuggestionsEnabled: false,
      },
      null,
      2,
    ),
  );
}
