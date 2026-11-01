import { describe, expect, it, vi } from "vitest";
import {
  DefaultRuntimeConfig,
  createProjectId,
  createSessionId,
  type ModelSelection,
} from "@origin-ai/cf-contracts";
import type { AgentRuntime } from "@origin-ai/cf-core";

import { createSessionFacade } from "../src/app/session-facade.js";

describe("session facade shutdown", () => {
  it("keeps group mode changes in the session rather than the project", async () => {
    const saveProjectPermissionMode = vi.fn();
    const updateSession = vi.fn(async () => undefined);
    const setExecutionState = vi.fn();
    const facade = createSessionFacade({
      configResult: { config: DefaultRuntimeConfig },
      sessionId: "group-session",
      traceContext: { traceId: "group-mode" },
      runtime: { getMode: () => "build", setExecutionState },
      logger: { info: vi.fn(), warn: vi.fn() },
      localSettingStore: { saveProjectPermissionMode },
      sessionStore: {
        getSession: async () => ({ permission: { version: 1, scope: "session", mode: "build" } }),
        updateSession,
      },
    } as never);
    await facade.setMode("yolo");
    expect(saveProjectPermissionMode).not.toHaveBeenCalled();
    expect(updateSession).toHaveBeenCalledWith({
      id: "group-session",
      permission: { version: 1, scope: "session", mode: "yolo" },
    });
    expect(setExecutionState).toHaveBeenCalledWith({ mode: "yolo" }, { traceId: "group-mode" });
  });

  it("begins shutdown before draining Memory Extraction and closing owned resources", async () => {
    const drainGate = deferred<void>();
    const calls: string[] = [];
    const drainMemoryExtractions = vi.fn(async (timeoutMs?: number) => {
      expect(timeoutMs).toBe(60_000);
      calls.push("drain:start");
      await drainGate.promise;
      calls.push("drain");
    });
    const facade = createSessionFacade({
      closeDynamicWorkflowRuns: async () => {
        calls.push("dwf");
      },
      configResult: {
        config: DefaultRuntimeConfig,
        configPort: {} as never,
        sources: {} as never,
      },
      configuredMcpServers: {},
      executionPort: {
        async close() {
          calls.push("execution");
        },
      } as never,
      logger: {} as never,
      loggerFactory: {} as never,
      mcpPort: {
        async close() {
          calls.push("mcp");
        },
      } as never,
      modelAdapter: {} as never,
      modelConfig: undefined,
      ownsExecutionPort: true,
      ownsMcpPort: true,
      ownsSessionStore: true,
      prepareResume: async () => {},
      prepareUserExecutionBoundary: async () => {},
      projectID: createProjectId("session-facade-memory-drain"),
      resolveUiLocale: () => "en-US",
      runtime: {
        beginShutdown: vi.fn(() => {
          calls.push("shutdown");
        }),
        closeBrowserSession: async () => {
          calls.push("browser");
        },
        drainMemoryExtractions,
        getModelRef: () => ({ providerId: "builtin:zai", modelId: "GLM-5" }),
      } as unknown as AgentRuntime,
      sessionId: createSessionId("session-facade-memory-drain"),
      sessionStore: {
        close() {
          calls.push("store");
        },
      } as never,
      traceContext: {} as never,
      untrustedProjectMcpServers: new Set(),
      workingDirectory: "/workspace",
    });

    const closing = facade.close?.();
    await nextTask();
    expect(calls).toEqual(["shutdown", "drain:start"]);

    drainGate.resolve();
    await closing;

    expect(drainMemoryExtractions).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      "shutdown",
      "drain:start",
      "drain",
      "dwf",
      "shutdown",
      "browser",
      "execution",
      "mcp",
      "store",
    ]);
  });

  it("still closes owned resources when closing dynamic workflow runs throws", async () => {
    const calls: string[] = [];
    const warn = vi.fn();
    const facade = createSessionFacade({
      closeDynamicWorkflowRuns: async () => {
        calls.push("dwf");
        throw new Error("engine refused to stop");
      },
      configResult: {
        config: DefaultRuntimeConfig,
        configPort: {} as never,
        sources: {} as never,
      },
      configuredMcpServers: {},
      executionPort: {
        async close() {
          calls.push("execution");
        },
      } as never,
      logger: { warn } as never,
      loggerFactory: {} as never,
      mcpPort: {
        async close() {
          calls.push("mcp");
        },
      } as never,
      modelAdapter: {} as never,
      modelConfig: undefined,
      ownsExecutionPort: true,
      ownsMcpPort: true,
      ownsSessionStore: true,
      prepareResume: async () => {},
      prepareUserExecutionBoundary: async () => {},
      projectID: createProjectId("session-facade-dwf-close-throws"),
      resolveUiLocale: () => "en-US",
      runtime: {
        beginShutdown: () => {
          calls.push("shutdown");
        },
        closeBrowserSession: async () => {
          calls.push("browser");
        },
        drainMemoryExtractions: async () => {
          calls.push("drain");
        },
      } as unknown as AgentRuntime,
      sessionId: createSessionId("session-facade-dwf-close-throws"),
      sessionStore: {
        close() {
          calls.push("store");
        },
      } as never,
      traceContext: {} as never,
      untrustedProjectMcpServers: new Set(),
      workingDirectory: "/workspace",
    });

    await facade.close?.();

    expect(calls).toEqual([
      "shutdown",
      "drain",
      "dwf",
      "shutdown",
      "browser",
      "execution",
      "mcp",
      "store",
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("session facade model selection", () => {
  it("reads and updates the session selection without projecting a runtime ModelSelection", async () => {
    let modelSelection: ModelSelection = {
      providerId: "temporary-provider",
      modelId: "temporary-model",
      options: { reasoningLevel: "high" },
    };
    const provider = {
      providerId: "temporary-provider",
      config: { label: "Temporary", enabled: true },
      models: [
        {
          modelId: "temporary-model",
          config: {
            optionSpecs: {
              reasoningLevel: { values: ["low", "high"] },
            },
          },
        },
      ],
    };
    const saveSessionEntry = vi.fn(async () => {});
    const validateSelection = vi.fn((selection: ModelSelection) =>
      selection.options?.reasoningLevel === "invalid"
        ? {
            ok: false,
            code: "reasoning-level-not-supported",
            ...selection,
            reasoningLevel: "invalid",
          }
        : { ok: true },
    );
    const facade = createSessionFacade({
      configResult: {
        config: DefaultRuntimeConfig,
        configPort: {} as never,
        sources: {} as never,
      },
      configuredMcpServers: {},
      executionPort: {} as never,
      logger: { info: vi.fn(), warn: vi.fn() } as never,
      loggerFactory: {} as never,
      localSettingStore: {
        getProjectPermissionMode: () => null,
        saveProjectPermissionMode: vi.fn(),
      },
      ownsExecutionPort: false,
      ownsMcpPort: false,
      ownsSessionStore: false,
      prepareResume: async () => {},
      prepareUserExecutionBoundary: async () => {},
      projectID: createProjectId("session-facade-selection"),
      providerRegistry: {
        getProvider: () => provider,
        getModel: () => provider.models[0],
        getView: () => ({ providers: [provider] }),
        validateSelection,
      } as never,
      resolveUiLocale: () => "en-US",
      runtime: {
        getSessionModelSelection: () => modelSelection,
        setSessionModelSelection: (selection: typeof modelSelection) => {
          modelSelection = selection;
        },
        updateConfig: vi.fn(),
        recordPendingModelChange: vi.fn(),
      } as unknown as AgentRuntime,
      sessionId: createSessionId("session-facade-selection"),
      sessionStore: { saveSessionEntry } as never,
      traceContext: { traceId: "trace-selection" } as never,
      untrustedProjectMcpServers: new Set(),
      workingDirectory: "/workspace",
    });

    expect(facade.getModel()).toBe("temporary-provider/temporary-model");
    expect(facade.getDefaultThoughtLevel()).toBeUndefined();
    expect(facade.getThoughtLevel()).toBe("high");
    expect(facade.listThoughtLevels()).toEqual(["low", "high"]);
    await expect(
      facade.setModel("temporary-provider/temporary-model", { transient: true }),
    ).resolves.not.toHaveProperty("thoughtLevel");
    expect(modelSelection).toEqual({
      providerId: "temporary-provider",
      modelId: "temporary-model",
    });
    await expect(facade.setThoughtLevel("low")).resolves.toMatchObject({
      previousThoughtLevel: undefined,
      thoughtLevel: "low",
    });
    expect(modelSelection.options?.reasoningLevel).toBe("low");

    saveSessionEntry.mockClear();
    const submitted: ModelSelection = {
      providerId: "temporary-provider",
      modelId: "temporary-model",
      options: { reasoningLevel: "high" },
    };
    await facade.setModel(submitted);
    expect(validateSelection).toHaveBeenLastCalledWith(submitted);
    expect(modelSelection).toEqual(submitted);
    expect(saveSessionEntry).toHaveBeenCalledTimes(1);
    expect(saveSessionEntry).toHaveBeenLastCalledWith(expect.objectContaining({ data: submitted }));
    submitted.options!.reasoningLevel = "low";
    expect(modelSelection.options?.reasoningLevel).toBe("high");

    saveSessionEntry.mockClear();
    await expect(
      facade.setModel({ ...submitted, options: { reasoningLevel: "invalid" } }),
    ).rejects.toThrow("not supported");
    expect(modelSelection.options?.reasoningLevel).toBe("high");
    expect(saveSessionEntry).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
