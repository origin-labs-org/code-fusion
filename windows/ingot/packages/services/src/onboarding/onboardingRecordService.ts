import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  onboardingDecisionSchema,
  onboardingRecordEntrySchema,
  onboardingRecordFileSchema,
} from "@origin-ai/cf-shared";
import { appSettingsOccupationEnum } from "@origin-ai/cf-shared";
import type {
  OnboardingRecordEntry,
  OnboardingRecordEntryInput,
  OnboardingRecordFile,
} from "@origin-ai/cf-shared";
import { atomicWriteText } from "../fs/atomicFileUtils.js";
import { getAppConfigDir } from "../paths.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type {
  CreateOnboardingRecordServiceOptions,
  IOnboardingRecordService,
  OnboardingSettingsSyncPatch,
} from "./onboardingRecord.js";

const logger = createServiceLogger("onboardingRecordService");

function getRecordFile(): string {
  return join(getAppConfigDir(), "onboarding-record.json");
}

async function readRecordFile(filePath: string): Promise<OnboardingRecordFile | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    logger.warn(undefined, "read onboarding record failed:", err);
    return null;
  }
  try {
    return onboardingRecordFileSchema.parse(JSON.parse(raw));
  } catch (cause) {
    logger.warn(undefined, "invalid onboarding record json, treating as missing. error:", cause);
    return null;
  }
}

export function createOnboardingRecordService(
  options: CreateOnboardingRecordServiceOptions,
): IOnboardingRecordService {
  let writeQueue: Promise<unknown> = Promise.resolve();
  const enqueueWrite = <T>(task: () => Promise<T>): Promise<T> => {
    const queued = writeQueue.then(task, task) as Promise<T>;
    writeQueue = queued.catch(() => {});
    return queued;
  };
  const createFile = (deviceMid: string): OnboardingRecordFile => ({
    version: 2,
    deviceMid,
    entries: [],
    decisions: [],
  });
  const hasIdentityRecord = (file: OnboardingRecordFile, userId: string | null): boolean =>
    file.entries.some((entry) => entry.userId === userId) ||
    file.decisions.some((decision) => decision.userId === userId);

  return {
    async appendRecord(deviceMid: string, entry: OnboardingRecordEntryInput): Promise<void> {
      const userId = await options.loadUserId();
      await enqueueWrite(async () => {
        const filePath = getRecordFile();
        const existing = await readRecordFile(filePath);
        let file: OnboardingRecordFile;
        if (existing) {
          if (existing.deviceMid !== deviceMid) {
            logger.warn(
              undefined,
              "deviceMid mismatch, keep existing:",
              existing.deviceMid,
              "incoming:",
              deviceMid,
            );
          }
          file = existing;
        } else {
          file = createFile(deviceMid);
        }
        const record: OnboardingRecordEntry = {
          userId,
          ...entry,
          uploadState: "pending",
        };
        const previousIndex = file.entries.findIndex((item) => item.userId === userId);
        const validated = onboardingRecordEntrySchema.parse(record);
        if (previousIndex >= 0) file.entries[previousIndex] = validated;
        else file.entries.push(validated);
        file.decisions = file.decisions.filter((decision) => decision.userId !== userId);
        await mkdir(join(filePath, ".."), { recursive: true });
        await atomicWriteText(filePath, JSON.stringify(file, null, 2));
      });
    },

    async claimAnonymousRecord(): Promise<void> {
      const userId = await options.loadUserId();
      if (!userId) return;
      await enqueueWrite(async () => {
        const filePath = getRecordFile();
        const file = await readRecordFile(filePath);
        if (!file) return;
        if (hasIdentityRecord(file, userId)) return;
        for (let i = file.entries.length - 1; i >= 0; i -= 1) {
          if (file.entries[i]!.userId === null) {
            file.entries[i] = onboardingRecordEntrySchema.parse({
              ...file.entries[i]!,
              userId,
            });
            await atomicWriteText(filePath, JSON.stringify(file, null, 2));
            return;
          }
        }
        for (let i = file.decisions.length - 1; i >= 0; i -= 1) {
          if (file.decisions[i]!.userId !== null) continue;
          file.decisions[i] = onboardingDecisionSchema.parse({ ...file.decisions[i]!, userId });
          await atomicWriteText(filePath, JSON.stringify(file, null, 2));
          return;
        }
      });
    },

    async shouldOnboard(deviceMid: string): Promise<boolean> {
      const userId = await options.loadUserId();
      const file = await readRecordFile(getRecordFile());
      if (file && hasIdentityRecord(file, userId)) return false;
      if (!(await options.hasExistingLocalTask())) return true;
      await enqueueWrite(async () => {
        const filePath = getRecordFile();
        const current = (await readRecordFile(filePath)) ?? createFile(deviceMid);
        if (hasIdentityRecord(current, userId)) return;
        current.decisions.push(
          onboardingDecisionSchema.parse({
            userId,
            status: "existing_local_user",
            reason: "existing_local_task",
            decidedAt: new Date().toISOString(),
          }),
        );
        await mkdir(join(filePath, ".."), { recursive: true });
        await atomicWriteText(filePath, JSON.stringify(current, null, 2));
      });
      return false;
    },

    async dismissOnboarding(deviceMid: string): Promise<void> {
      const userId = await options.loadUserId();
      await enqueueWrite(async () => {
        const filePath = getRecordFile();
        const file = (await readRecordFile(filePath)) ?? createFile(deviceMid);
        if (file.entries.some((entry) => entry.userId === userId)) return;
        const decision = onboardingDecisionSchema.parse({
          userId,
          status: "dismissed",
          reason: "user_closed",
          decidedAt: new Date().toISOString(),
        });
        const index = file.decisions.findIndex((item) => item.userId === userId);
        if (index >= 0) file.decisions[index] = decision;
        else file.decisions.push(decision);
        await mkdir(join(filePath, ".."), { recursive: true });
        await atomicWriteText(filePath, JSON.stringify(file, null, 2));
      });
    },

    async getLatestEntry(): Promise<OnboardingRecordEntry | null> {
      const userId = await options.loadUserId();
      const file = await readRecordFile(getRecordFile());
      if (!file) return null;
      let latest: OnboardingRecordEntry | undefined;
      for (const entry of file.entries) {
        if (entry.userId === userId) latest = entry;
      }
      return latest ?? null;
    },

    async syncSettingsFromRecord(): Promise<OnboardingSettingsSyncPatch | null> {
      const userId = await options.loadUserId();
      const file = await readRecordFile(getRecordFile());
      if (!file) return null;
      let latest: OnboardingRecordEntry | undefined;
      for (const entry of file.entries) {
        if (entry.userId === userId) latest = entry;
      }
      if (!latest) return null;
      const occupation = appSettingsOccupationEnum.safeParse(latest.occupation);
      return {
        onboardingOccupation: (occupation.success ? occupation.data : null) ?? "other",
        proactiveSuggestionsEnabled: latest.proactiveSuggestionsEnabled ?? false,
        memoryEnabled: latest.memoryEnabled ?? false,
      };
    },

    async updateRecordPreferences(
      patch: Partial<
        Pick<OnboardingRecordEntryInput, "memoryEnabled" | "proactiveSuggestionsEnabled">
      >,
    ): Promise<void> {
      const userId = await options.loadUserId();
      await enqueueWrite(async () => {
        const filePath = getRecordFile();
        const file = await readRecordFile(filePath);
        if (!file) return;
        const index = file.entries.findLastIndex((entry) => entry.userId === userId);
        if (index < 0) return;
        file.entries[index] = onboardingRecordEntrySchema.parse({
          ...file.entries[index],
          ...patch,
        });
        await atomicWriteText(filePath, JSON.stringify(file, null, 2));
      });
    },

    async getRecords(): Promise<OnboardingRecordFile | null> {
      return readRecordFile(getRecordFile());
    },

    async clearRecords(): Promise<void> {
      await enqueueWrite(async () => {
        await rm(getRecordFile(), { force: true });
      });
    },
  };
}
