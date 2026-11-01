import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "@origin-ai/cf-shared/node";
import {
  botsConfigFileSchema,
  botsStateFileSchema,
  type BotsConfigFile,
  type BotsStateFile,
  type BotContextState,
} from "@origin-ai/cf-shared";
import { getAppConfigDir } from "../paths.js";
import {
  BOTS_CONFIG_FILE,
  BOTS_LEGACY_CONFIG_FILE,
  BOTS_LEGACY_STATE_FILE,
  BOTS_V2_STATE_FILE,
  BOTS_STATE_FILE,
  createDefaultBotsConfig,
} from "./config.js";
import { importLegacyBotConfig, importLegacyBotState } from "./storageMigration.js";

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await atomicWritePrivateTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export class BotsRepo {
  private readonly configDir = getAppConfigDir();
  async readConfig(): Promise<BotsConfigFile> {
    const path = join(this.configDir, BOTS_CONFIG_FILE);
    return withFileLock(path, async () => {
      const current = await readOptionalJson(path);
      if (current !== undefined) return botsConfigFileSchema.parse(current);
      const legacy = await readOptionalJson(join(this.configDir, BOTS_LEGACY_CONFIG_FILE));
      const config = botsConfigFileSchema.parse(
        legacy === undefined ? createDefaultBotsConfig() : importLegacyBotConfig(legacy),
      );
      await writeJson(path, config);
      return config;
    });
  }

  async writeConfig(config: BotsConfigFile): Promise<BotsConfigFile> {
    const parsed = botsConfigFileSchema.parse(config);
    const path = join(this.configDir, BOTS_CONFIG_FILE);
    await withFileLock(path, () => writeJson(path, parsed));
    return parsed;
  }

  async readState(): Promise<BotsStateFile> {
    const path = join(this.configDir, BOTS_STATE_FILE);
    return withFileLock(path, () => this.readStateUnlocked(path));
  }

  private async readStateUnlocked(path: string): Promise<BotsStateFile> {
    const current = await readOptionalJson(path);
    if (current !== undefined) return botsStateFileSchema.parse(current);
    const v2 = await readOptionalJson(join(this.configDir, BOTS_V2_STATE_FILE));
    const legacy =
      v2 === undefined ? await readOptionalJson(join(this.configDir, BOTS_LEGACY_STATE_FILE)) : v2;
    const state = botsStateFileSchema.parse(
      legacy === undefined ? { version: 3, bots: {} } : importLegacyBotState(legacy),
    );
    await writeJson(path, state);
    return state;
  }

  
  async updateContext(
    botId: string,
    update: (current: BotContextState | undefined) => BotContextState | undefined,
  ): Promise<BotContextState | undefined> {
    const path = join(this.configDir, BOTS_STATE_FILE);
    return withFileLock(path, async () => {
      const state = await this.readStateUnlocked(path);
      const next = update(state.bots[botId]);
      if (next) state.bots[botId] = next;
      else delete state.bots[botId];
      const parsed = botsStateFileSchema.parse(state);
      await writeJson(path, parsed);
      return parsed.bots[botId];
    });
  }

  async writeState(state: BotsStateFile): Promise<BotsStateFile> {
    const parsed = botsStateFileSchema.parse(state);
    const path = join(this.configDir, BOTS_STATE_FILE);
    await withFileLock(path, () => writeJson(path, parsed));
    return parsed;
  }
}
