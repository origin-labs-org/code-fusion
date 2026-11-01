import { setupBrowserRuntime as setupCoreBrowserRuntime } from "@origin-ai/cf-core/browser-client";
import { readNodeReplBrowserRuntimeBridge } from "@origin-ai/cf-node-repl-host/runtime-bridge";

export async function setupBrowserRuntime(input: {
  globals: Record<PropertyKey, unknown>;
}): Promise<void> {
  const bridge = readNodeReplBrowserRuntimeBridge(input.globals);
  bridge.assertAvailable();
  setupCoreBrowserRuntime({
    globals: input.globals as Record<string, unknown>,
    transport: bridge,
    documentationRoot: bridge.documentationRoot,
    assertAvailable: bridge.assertAvailable,
  });
}
