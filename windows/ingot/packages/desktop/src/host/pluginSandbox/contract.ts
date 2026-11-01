import type { PluginSandboxHandle, PluginSandboxRegisterInput } from "@origin-ai/cf-shared/mcp-apps";

export interface PluginSandboxRegistrationBridge {
  register(input: PluginSandboxRegisterInput): Promise<PluginSandboxHandle>;
  accept(
    result: Partial<PluginSandboxHandle> & { requestId: string; ok: boolean; error?: string },
  ): void;
  dispose(): void;
}
