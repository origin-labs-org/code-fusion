import { describe, expect, it, vi } from "vitest";
import {
  CoreErrorType,
  HookEventName,
  ModelErrorCode,
  ModelProtocolError,
  SessionEventType,
  createSessionId,
  type SessionEvent,
} from "@origin-ai/cf-contracts";
import { createTestModelSelection } from "./test-model-selection.js";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { createTestModelFactory } from "./test-runtime-model.js";
import { createRecordingSubagentSessionStore } from "./subagent-test-store.js";

const CREATION_ERROR_MESSAGE = "Original model selection is unavailable";
const MODEL_CREATION_FAILED_MESSAGE = "Model creation failed";
const MODEL_CREATION_TURN_PHASE = "model_creation";
const LIFECYCLE_EVENT_TYPES = new Set<string>([
  SessionEventType.TurnStarted,
  SessionEventType.TurnComplete,
  SessionEventType.TurnError,
]);
const RUNTIME_CONFIG = {
  modelSelection: createTestModelSelection("user-provider/user-model"),
  titleGeneration: { enabled: false },
  workingDirectory: "/workspace/project",
};
const TEXT_ATTACHMENT = {
  type: "file" as const,
  content: `data:text/plain;base64,${Buffer.from("pasted notes").toString("base64")}`,
  filename: "notes.txt",
  mimeType: "text/plain",
  sourceKind: "clipboard-text" as const,
};

function createFailingModelFactory() {
  return createTestModelFactory({
    onCreate() {
      throw new ModelProtocolError(ModelErrorCode.ProviderNotFound, CREATION_ERROR_MESSAGE);
    },
  });
}

function lifecycleEvents(events: SessionEvent[]): SessionEvent[] {
  return events.filter((event) => LIFECYCLE_EVENT_TYPES.has(event.type));
}

describe("AgentRuntime model creation failure lifecycle", () => {
  it("persists the accepted input without initializing context after model creation fails", async () => {
    const sessionId = createSessionId("runtime-creation-failure-context");
    const eventStore = createTestSessionEventStore();
    const sessionStore = createRecordingSubagentSessionStore();
    const resolveContextSources = vi.fn(async () => {
      throw new Error("context source unavailable");
    });
    const runtime = createTestAgentRuntime(sessionId, RUNTIME_CONFIG, {
      contextSourcePort: { resolveContextSources } as never,
      eventStore,
      sessionStore,
      modelFactory: createFailingModelFactory(),
    });

    await expect(
      runtime.executeTurn("replacement input", undefined, { inputId: "command-context-error" }),
    ).rejects.toMatchObject({
      message: MODEL_CREATION_FAILED_MESSAGE,
      cause: expect.objectContaining({ message: CREATION_ERROR_MESSAGE }),
    });

    expect(resolveContextSources).not.toHaveBeenCalled();
    expect(
      lifecycleEvents(await eventStore.getEvents(sessionId)).map((event) => event.type),
    ).toEqual([SessionEventType.TurnStarted, SessionEventType.TurnError]);
    const [persistedUser] = await sessionStore.messages({ sessionID: sessionId });
    expect(persistedUser).toMatchObject({
      info: { role: "user", anchor: { sourceCommandId: "command-context-error" } },
      parts: [{ type: "text", text: "replacement input" }],
    });
  });

  it("defers SessionStart and preserves accepted input until model creation recovers", async () => {
    const sessionId = createSessionId("runtime-creation-failure-session-start");
    const hookEvents: HookEventName[] = [];
    let failCreation = true;
    const runtime = createTestAgentRuntime(sessionId, RUNTIME_CONFIG, {
      eventStore: createTestSessionEventStore(),
      hookRunner: {
        run: vi.fn(async (input) => {
          hookEvents.push(input.hookEventName);
          return { additionalContexts: [] };
        }),
      },
      sessionStore: createRecordingSubagentSessionStore(),
      modelFactory: createTestModelFactory({
        onCreate() {
          if (failCreation) {
            throw new ModelProtocolError(ModelErrorCode.ProviderNotFound, CREATION_ERROR_MESSAGE);
          }
        },
        async generateText(request, observation) {
          expect(JSON.stringify(request.messages)).toContain("persist while unavailable");
          return {
            finishReason: "stop",
            model: observation.model,
            text: "model recovered",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        },
      }),
    });

    await expect(
      runtime.executeTurn("persist while unavailable", undefined, {
        inputId: "command-session-start-failed",
      }),
    ).rejects.toMatchObject({ message: MODEL_CREATION_FAILED_MESSAGE });
    expect(hookEvents).toEqual([HookEventName.UserPromptSubmit]);

    failCreation = false;
    await expect(
      runtime.executeTurn("run after recovery", undefined, {
        inputId: "command-session-start-recovered",
      }),
    ).resolves.toMatchObject({ response: "model recovered" });
    expect(hookEvents).toEqual([
      HookEventName.UserPromptSubmit,
      HookEventName.SessionStart,
      HookEventName.UserPromptSubmit,
      HookEventName.Stop,
    ]);
  });
  it("keeps the model creation error as the terminal error when accepted input persistence fails", async () => {
    const sessionId = createSessionId("runtime-creation-failure-persistence-error");
    const eventStore = createTestSessionEventStore();
    const runtime = createTestAgentRuntime(sessionId, RUNTIME_CONFIG, {
      artifactStore: {
        writeToolResultBinaryArtifact: vi.fn(async () => {
          throw new Error("artifact disk full");
        }),
      } as never,
      eventStore,
      sessionStore: createRecordingSubagentSessionStore(),
      modelFactory: createFailingModelFactory(),
    });

    await expect(
      runtime.executeTurn("persist after creation failure", [TEXT_ATTACHMENT], {
        inputId: "command-persistence-error",
      }),
    ).rejects.toMatchObject({
      message: MODEL_CREATION_FAILED_MESSAGE,
      cause: expect.objectContaining({ message: CREATION_ERROR_MESSAGE }),
    });

    const lifecycle = lifecycleEvents(await eventStore.getEvents(sessionId));
    expect(lifecycle.map((event) => event.type)).toEqual([
      SessionEventType.TurnStarted,
      SessionEventType.TurnError,
    ]);
    expect(lifecycle[1]?.payload).toMatchObject({
      turnPhase: MODEL_CREATION_TURN_PHASE,
      inputId: "command-persistence-error",
      error: { message: CREATION_ERROR_MESSAGE },
    });
  });

  it("finishes as cancelled when the user stops while accepted input is persisting", async () => {
    const sessionId = createSessionId("runtime-creation-failure-cancelled");
    const eventStore = createTestSessionEventStore();
    const controller = new AbortController();
    const runtime = createTestAgentRuntime(sessionId, RUNTIME_CONFIG, {
      artifactStore: {
        writeToolResultBinaryArtifact: vi.fn(async () => {
          controller.abort();
          throw Object.assign(new Error("artifact write aborted"), { name: "AbortError" });
        }),
      } as never,
      eventStore,
      sessionStore: createRecordingSubagentSessionStore(),
      modelFactory: createFailingModelFactory(),
    });

    await expect(
      runtime.executeTurn("stop while persisting", [TEXT_ATTACHMENT], {
        abortSignal: controller.signal,
        inputId: "command-cancelled",
      }),
    ).rejects.toMatchObject({ type: CoreErrorType.TurnCancelled });

    const lifecycle = lifecycleEvents(await eventStore.getEvents(sessionId));
    expect(lifecycle.map((event) => event.type)).toEqual([
      SessionEventType.TurnStarted,
      SessionEventType.TurnComplete,
    ]);
    expect(lifecycle[1]?.payload).toMatchObject({
      resultType: "cancelled",
      inputId: "command-cancelled",
    });
  });

  it("keeps manual compact creation failures on the immediate terminal path", async () => {
    const sessionId = createSessionId("runtime-creation-failure-compact");
    const eventStore = createTestSessionEventStore();
    const sessionStore = createRecordingSubagentSessionStore();
    let failCreation = false;
    const runtime = createTestAgentRuntime(sessionId, RUNTIME_CONFIG, {
      eventStore,
      sessionStore,
      modelFactory: createTestModelFactory({
        onCreate() {
          if (failCreation) {
            throw new ModelProtocolError(ModelErrorCode.ProviderNotFound, CREATION_ERROR_MESSAGE);
          }
        },
        async generateText(_request, observation) {
          return {
            finishReason: "stop",
            model: observation.model,
            text: "first answer",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        },
      }),
    });
    await runtime.executeTurn("first prompt", undefined, { inputId: "command-first" });
    const eventCountBeforeCompact = (await eventStore.getEvents(sessionId)).length;
    const messagesBeforeCompact = await sessionStore.messages({ sessionID: sessionId });
    failCreation = true;

    await expect(
      runtime.executeTurn("/compact", undefined, { inputId: "command-compact" }),
    ).rejects.toMatchObject({
      message: MODEL_CREATION_FAILED_MESSAGE,
      cause: expect.objectContaining({ message: CREATION_ERROR_MESSAGE }),
    });

    const compactLifecycle = lifecycleEvents(
      (await eventStore.getEvents(sessionId)).slice(eventCountBeforeCompact),
    );
    expect(compactLifecycle.map((event) => event.type)).toEqual([SessionEventType.TurnError]);
    expect(compactLifecycle[0]?.payload).toMatchObject({
      turnPhase: MODEL_CREATION_TURN_PHASE,
      inputId: "command-compact",
      error: { message: CREATION_ERROR_MESSAGE },
    });
    expect(await sessionStore.messages({ sessionID: sessionId })).toEqual(messagesBeforeCompact);
  });

  it("lets a UserPromptSubmit block finish the turn without persisting the prompt", async () => {
    const sessionId = createSessionId("runtime-creation-failure-hook-blocked");
    const eventStore = createTestSessionEventStore();
    const sessionStore = createRecordingSubagentSessionStore();
    const runtime = createTestAgentRuntime(sessionId, RUNTIME_CONFIG, {
      eventStore,
      hookRunner: {
        run: vi.fn(async (input) =>
          input.hookEventName === HookEventName.UserPromptSubmit
            ? {
                additionalContexts: [],
                preventContinuation: true,
                stopReason: "blocked by policy",
              }
            : { additionalContexts: [] },
        ),
      },
      sessionStore,
      modelFactory: createFailingModelFactory(),
    });

    await expect(
      runtime.executeTurn("blocked prompt", undefined, { inputId: "command-hook-blocked" }),
    ).resolves.toMatchObject({ response: "blocked by policy" });

    const lifecycle = lifecycleEvents(await eventStore.getEvents(sessionId));
    expect(lifecycle.map((event) => event.type)).toEqual([
      SessionEventType.TurnStarted,
      SessionEventType.TurnComplete,
    ]);
    expect(lifecycle[1]?.payload).toMatchObject({
      resultType: "success",
      inputId: "command-hook-blocked",
    });
    expect(await sessionStore.messages({ sessionID: sessionId })).toEqual([]);
  });

  it("rejects guide steering into a creation-failure turn", async () => {
    const sessionId = createSessionId("runtime-creation-failure-steer");
    const sessionStore = createRecordingSubagentSessionStore();
    const steerResults: unknown[] = [];
    const saveMessage = sessionStore.saveMessage.bind(sessionStore);
    let runtime: ReturnType<typeof createTestAgentRuntime> | undefined;
    sessionStore.saveMessage = async (message) => {
      if (message.role === "user" && runtime && steerResults.length === 0) {
        steerResults.push(
          await runtime.steerTurn({ delivery: "guide", input: "guide while failing" }),
        );
      }
      await saveMessage(message);
    };
    runtime = createTestAgentRuntime(sessionId, RUNTIME_CONFIG, {
      eventStore: createTestSessionEventStore(),
      sessionStore,
      modelFactory: createFailingModelFactory(),
    });

    await expect(
      runtime.executeTurn("persist then fail", undefined, { inputId: "command-steer" }),
    ).rejects.toMatchObject({ message: MODEL_CREATION_FAILED_MESSAGE });

    expect(steerResults).toEqual([
      expect.objectContaining({ kind: "rejected", reason: "turn_not_steerable" }),
    ]);
  });
});
