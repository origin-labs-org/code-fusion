import { getGenUiOutputDirectory } from "@origin-ai/cf-shared/node";
import type { AgentRuntimeInternal } from "../internal.js";

export function resolveGenUiOutputDirectory(runtime: AgentRuntimeInternal): string | undefined {
  if (runtime.config.presentationSurface !== "cf_desktop" || !runtime.config.genUiOutputRoot)
    return undefined;
  return getGenUiOutputDirectory(runtime.config.genUiOutputRoot, {
    workspacePath: runtime.config.workspacePath ?? runtime.workspaceRoot,
    workspaceIdentity: runtime.config.workspaceIdentity,
    sessionId: runtime.sessionId,
  });
}

export async function ensureGenUiOutputDirectory(runtime: AgentRuntimeInternal): Promise<void> {
  const path = resolveGenUiOutputDirectory(runtime);
  if (!path) return;
  if (!runtime.fileSystemPort) throw new Error("Gen UI output requires FileSystemPort");
  await runtime.fileSystemPort.createDirectory({ path, trace: runtime.rootTraceContext });
}
