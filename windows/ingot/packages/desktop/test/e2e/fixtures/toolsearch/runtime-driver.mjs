import {
  createCfApp,
  startProcessProviderRegistryRuntime,
} from "../../../../../../apps/cli/packages/bootstrap/dist/index.js";

const providers = await startProcessProviderRegistryRuntime(process.env);
const options = JSON.parse(process.argv[3] ?? "{}");
const recordingTool = "mcp__catalog__lookup";
const recordedRequests = [];
const app = await createCfApp({
  providerRegistry: providers.runtime.registryService,
  configuredDefaultModelSelection: providers.configuredDefaultModelSelection,
  env: process.env,
  eventSink: {
    onSessionEvent(event) {
      if (event.type === "model_request") recordedRequests.push(structuredClone(event.payload));
    },
  },
  runtimeConfig: {
    workingDirectory: process.cwd(),
    toolSearch: { mode: options.mode ?? "native" },
    modelStreaming: process.argv[2] ?? "on",
    titleGeneration: { enabled: false },
    toolAllowlist: [
      "Read",
      "ToolSearch",
      "WebFetch",
      "TodoWrite",
      "DeferredToolCall",
      ...(options.recording ? [recordingTool] : []),
    ],
    ...(options.autoCompact
      ? { compact: { contextWindow: 40000, bufferTokens: 10, summaryReserveTokens: 0 } }
      : {}),
  },
});
await app.runtime.ensureSessionPersistedForExternalActivity("E2E_TOOLSEARCH_CATALOG_SETUP");
await app.resume();
const registry = app.runtime.getToolRegistry();
const original = new Map(registry.list().map((name) => [name, registry.get(name)]));
process.on("message", async ({ id, command, name, state, prompt }) => {
  try {
    let value;
    if (command === "catalog") {
      if (state === "absent") registry.unregister(name);
      else {
        const entry = original.get(name);
        if (!entry) throw new Error(`Unknown test tool: ${name}`);
        registry.register(
          { ...entry, metadata: { ...entry.metadata, alwaysLoad: state === "resident" } },
          { silentDuplicateWarning: true },
        );
      }
      app.runtime.invalidateToolCache();
    } else if (command === "turn") {
      await app.submitPrompt(prompt);
    } else if (command === "history") {
      value = app.runtime.messageHistory.toRuntimeEntries();
    } else if (command === "records") {
      value = recordedRequests;
    } else if (command === "close") {
      await app.close();
      providers.dispose();
      process.send({ id, value });
      process.disconnect();
      return;
    } else throw new Error(`Unknown driver command: ${command}`);
    process.send({ id, value });
  } catch (error) {
    process.send({ id, error: error.stack ?? String(error) });
  }
});
process.send({ ready: true });
