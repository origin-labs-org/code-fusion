export type CfAgentBinaryKind = "native-binary";

export interface CfAgentRuntimeDescriptor {
  binaryKind: CfAgentBinaryKind;
  binaryEnvVar: string;
  bundledResourceDir: string;
  version: string;
  spawnArgs: string[];
  nativeConfigDir: string;
  nativeConfigFileName: string;
  missingBinaryMessage: string;
  resolveEntrySegments(platform: string): string[];
  
  nodeBundleEntryFile: string;
  resolveNodeBundleSegments(): string[];
}

export function resolvePlatformBinaryName(binaryName: string, platform: string): string {
  return platform === "win32" ? `${binaryName}.exe` : binaryName;
}

export const CF_AGENT_RUNTIME: CfAgentRuntimeDescriptor = {
  binaryKind: "native-binary",
  binaryEnvVar: "GLM_BINARY_PATH",
  bundledResourceDir: "glm",
  version: "0.13.3",
  spawnArgs: ["app-server", "--stdio"],
  nativeConfigDir: ".cf/cli",
  nativeConfigFileName: "config.json",
  missingBinaryMessage:
    "[CodeFusion Agent] glm binary 未找到，请设置 CF_AGENT_WORKDIR、GLM_BINARY_PATH 或先准备 GLM 运行时资源",
  resolveEntrySegments: (platform) => [resolvePlatformBinaryName("cf-agent", platform)],
  nodeBundleEntryFile: "cf.cjs",
  resolveNodeBundleSegments() {
    return [this.nodeBundleEntryFile];
  },
};

export function getCfAgentRuntime(): CfAgentRuntimeDescriptor {
  return CF_AGENT_RUNTIME;
}
