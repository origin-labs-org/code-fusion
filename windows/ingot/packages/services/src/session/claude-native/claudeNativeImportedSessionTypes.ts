import type { CfPersistedMessage, CfTaskPersistStatus } from "@origin-ai/cf-shared";

export type ClaudeNativeImportSourceProvider = "claude";

export interface ClaudeNativeImportedSessionSource {
  provider: ClaudeNativeImportSourceProvider;
  sessionId: string;
  workspacePath: string;
  sourcePath: string;
  createdAt: number;
  updatedAt: number;
  title?: string;
  model?: string;
  status?: CfTaskPersistStatus;
  migrationSource?: "claudeCode";
  messages: CfPersistedMessage[];
}
