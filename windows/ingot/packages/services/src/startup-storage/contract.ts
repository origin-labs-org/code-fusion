import type { MigrationResult } from "@origin-ai/cf-shared/sqlite-migrations";

export interface AgentStorageMigrationInput {
  
  command: {
    command: string;
    args?: readonly string[];
    cwd?: string;
    env?: Record<string, string>;
  };
  env?: NodeJS.ProcessEnv;
}
export interface StartupStorageContract {
  
  migrateAgent(input: AgentStorageMigrationInput): Promise<MigrationResult>;
}
