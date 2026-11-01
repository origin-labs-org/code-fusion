import { describe, expect, it, vi } from "vitest";
import {
  createMessageId,
  createPartId,
  createProjectId,
  createSessionId,
  type MessageWithParts,
  type SessionInfo,
  type SessionStorePort,
} from "@origin-ai/cf-contracts";
import { AgentRuntime } from "../src/runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import {
  createTestModelFactory,
  type TestModelExecutionObservation,
} from "./test-runtime-model.js";
import type { ModelRequest } from "@origin-ai/cf-contracts";
import { createTestModelSelection } from "./test-model-selection.js";

describe("UnboundModel的 Session 历史恢复", () => {
  it("不创建executeModel也能恢复历史及 SessionStart hook，重New选模后Can continueSend", async () => {
    const sessionId = createSessionId("unbound-resume");
    const messageId = createMessageId("unbound-resume-history");
    const session: SessionInfo = {
      id: sessionId,
      projectID: createProjectId("unbound-resume"),
      directory: "/workspace/project",
      slug: "unbound-resume",
      title: "history stays readable",
      version: "test",
      taskType: "interactive",
      time: { created: 1, updated: 1 },
    };
    const messages: MessageWithParts[] = [
      {
        info: {
          id: messageId,
          sessionID: sessionId,
          role: "user",
          agent: "cf-agent",
          time: { created: 1 },
          modelSelection: createTestModelSelection("retired-provider/old-model"),
        },
        parts: [
          {
            id: createPartId("unbound-resume-text"),
            messageID: messageId,
            sessionID: sessionId,
            type: "text",
            text: "history before upgrade",
          },
        ],
      },
    ];
    const store = {
      getSession: vi.fn(async () => session),
      messages: vi.fn(async () => messages),
      sessionEntries: vi.fn(async () => []),
      readTodos: vi.fn(async () => []),
      readTarget: vi.fn(async () => null),
      saveMessage: vi.fn(async () => {}),
      savePart: vi.fn(async () => {}),
      saveSessionEntry: vi.fn(async () => {}),
      updateSession: vi.fn(async () => session),
    } as unknown as SessionStorePort;
    const generateText = vi.fn(
      async (_request: ModelRequest, observation: TestModelExecutionObservation) => ({
        finishReason: "stop" as const,
        model: observation.model,
        text: "continued",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }),
    );
    const factory = vi.fn(createTestModelFactory({ generateText }));
    const runHook = vi.fn(async () => ({ additionalContexts: [] }));
    const runtime = new AgentRuntime(
      sessionId,
      {
        workingDirectory: session.directory,
        titleGeneration: { enabled: false },
      },
      {
        eventStore: createTestSessionEventStore(),
        sessionStore: store,
        modelFactory: factory,
        hookRunner: { run: runHook },
      },
    );

    expect(await runtime.resumeFromStore()).toMatchObject({ messageCount: 1, partCount: 1 });
    expect(runtime.getSessionModelSelection()).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
    expect(runHook).toHaveBeenCalledWith(
      expect.objectContaining({ source: "resume", model: undefined }),
      expect.anything(),
    );

    const selection = createTestModelSelection("provider-b/model-b", { reasoningLevel: "high" });
    await runtime.executeTurn("continue after selecting", undefined, {
      intent: {
        kind: "sendText",
        modelSelection: selection,
        requestedDelivery: "start-now",
        sourceCommandId: "reselect",
      },
    });
    expect(runtime.getSessionModelSelection()).toEqual(selection);
    expect(generateText).toHaveBeenCalledOnce();
    expect(JSON.stringify(generateText.mock.calls[0]?.[0].messages)).toContain(
      "history before upgrade",
    );
  });

  it("未Select Model的Execution failed不调用 Factory，也不制造Default Selection", async () => {
    const factory = vi.fn(createTestModelFactory({}));
    const runtime = new AgentRuntime(
      createSessionId("unbound-send"),
      {
        workingDirectory: "/workspace/project",
        titleGeneration: { enabled: false },
      },
      { eventStore: createTestSessionEventStore(), modelFactory: factory },
    );
    await expect(runtime.executeTurn("not ready")).rejects.toMatchObject({
      message: "Model creation failed",
      cause: expect.objectContaining({ message: "Select a model before continuing" }),
    });
    expect(factory).not.toHaveBeenCalled();
    expect(runtime.getSessionModelSelection()).toBeUndefined();
  });
});
