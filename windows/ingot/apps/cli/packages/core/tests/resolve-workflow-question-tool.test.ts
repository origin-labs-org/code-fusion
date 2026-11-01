import {
  RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
  createRootTraceContext,
  createSessionId,
  createToolCallId,
  createTurnId,
  type DynamicWorkflowRunPort,
} from "@origin-ai/cf-contracts";
import { describe, expect, it } from "vitest";
import { PermissionService, defaultPermissionConfig } from "../src/permission/service.js";
import { createToolExecutor } from "../src/tool/executor.js";
import { registerBuiltInTools } from "../src/tool/handlers/index.js";
import { resolveWorkflowQuestionToolEntry } from "../src/tool/handlers/resolve-workflow-question.js";
import { createToolRegistry } from "../src/tool/registry.js";
import type { ToolExecutionContext } from "../src/tool/types.js";

function toolContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    abortSignal: new AbortController().signal,
    sessionId: "sess_resolve_question" as never,
    toolCallId: "tool_resolve_question",
    traceId: "trace_resolve_question" as never,
    workingDirectory: "/tmp",
    workspaceRoot: "/tmp",
    ...overrides,
  };
}

function portWith(
  resolveQuestion: DynamicWorkflowRunPort["resolveQuestion"],
): DynamicWorkflowRunPort {
  return { resolveQuestion } as unknown as DynamicWorkflowRunPort;
}

describe("ResolveWorkflowQuestion handler", () => {
  it("forwards the qid and answer, and confirms the run is still going", async () => {
    const seen: { qid: string; answer: string }[] = [];
    const port = portWith(async (qid, answer) => {
      seen.push({ qid, answer });
      return { ok: true, qid };
    });

    const output = await resolveWorkflowQuestionToolEntry.handler(
      { question_id: "dwfq-abc12345-1", answer: "Treat 95 as passing." },
      toolContext({ dynamicWorkflowRunPort: port }),
    );

    expect(seen).toEqual([{ qid: "dwfq-abc12345-1", answer: "Treat 95 as passing." }]);
    expect(output).toMatchObject({ ok: true, qid: "dwfq-abc12345-1" });
    const response = (output as { response: string }).response;
    expect(response).toContain("dwfq-abc12345-1");
    expect(response).toContain("run keeps going");
  });

  it.each([
    ["unknown_question", "Unknown question ID dwfq-nope-9. Use GetWorkflowRun to inspect the run\'s pendingQuestions."],
    ["already_resolved", "这个问题已经被回答过了，提问的子代理早已带着那次答案继续。"],
    ["run_not_in_flight", "这个 qid 所属的 run 已经不在飞行中，没有人在等这个答案。"],
  ] as const)("passes the %s refusal message through verbatim", async (reason, message) => {
    const port = portWith(async () => ({ ok: false, reason, message }));

    const output = await resolveWorkflowQuestionToolEntry.handler(
      { question_id: "dwfq-nope-9", answer: "..." },
      toolContext({ dynamicWorkflowRunPort: port }),
    );

    expect(output).toMatchObject({ result: false });
    expect((output as { message: string }).message).toBe(message);
  });

  it("gives each refusal reason its own stable error code", async () => {
    const codeFor = async (reason: string): Promise<number> => {
      const port = portWith(async () => ({ ok: false, reason: reason as never, message: "m" }));
      const output = await resolveWorkflowQuestionToolEntry.handler(
        { question_id: "dwfq-x-1", answer: "a" },
        toolContext({ dynamicWorkflowRunPort: port }),
      );
      return (output as { errorCode: number }).errorCode;
    };
    const codes = [
      await codeFor("unknown_question"),
      await codeFor("already_resolved"),
      await codeFor("run_not_in_flight"),
    ];
    expect(new Set(codes).size).toBe(3);
  });

  it("reports a capability gap when the port is absent, and when the method is absent", async () => {
    const expectUnavailable = (output: unknown): void => {
      expect(output).toMatchObject({ result: false });
      expect((output as { message: string }).message).toContain(
        "workflow_question_answering_unavailable",
      );
    };

    expectUnavailable(
      await resolveWorkflowQuestionToolEntry.handler(
        { question_id: "dwfq-x-1", answer: "a" },
        toolContext(),
      ),
    );
    expectUnavailable(
      await resolveWorkflowQuestionToolEntry.handler(
        { question_id: "dwfq-x-1", answer: "a" },
        toolContext({ dynamicWorkflowRunPort: {} as unknown as DynamicWorkflowRunPort }),
      ),
    );
  });

  it("rejects an input missing the answer", async () => {
    await expect(
      resolveWorkflowQuestionToolEntry.handler(
        { question_id: "dwfq-x-1" },
        toolContext({ dynamicWorkflowRunPort: portWith(async (qid) => ({ ok: true, qid })) }),
      ),
    ).rejects.toThrow();
  });
});

describe("ResolveWorkflowQuestion executor surface", () => {
  it("runs without an approval prompt and returns the confirmation as model content", async () => {
    const sessionId = createSessionId("resolve-question-exec");
    const turnId = createTurnId("resolve-question-exec");
    const traceContext = createRootTraceContext({ sessionId, turnId });
    const registry = createToolRegistry();
    registry.register(resolveWorkflowQuestionToolEntry);
    const executor = createToolExecutor({
      emitEvent: async () => undefined,
      permissionService: new PermissionService(defaultPermissionConfig),
      registry,
      dynamicWorkflowRunPort: portWith(async (qid) => ({ ok: true, qid })),
      sessionId,
      turnId,
      traceContext,
    });

    const result = await executor.execute(
      {
        id: createToolCallId("resolve-ok"),
        input: { question_id: "dwfq-abc12345-1", answer: "Treat 95 as passing." },
        name: RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
      },
      { traceContext },
    );

    expect(result.success).toBe(true);
    expect(result.modelContent).toContain("dwfq-abc12345-1");
  });
});

describe("ResolveWorkflowQuestion registration", () => {
  it("is always registered in a main runtime (no include gate of its own)", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, {});
    expect(registry.has(RESOLVE_WORKFLOW_QUESTION_TOOL_NAME)).toBe(true);
  });

  it("is not registered when a caller disallows it (the actor-session path)", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, {
      disallowedTools: [RESOLVE_WORKFLOW_QUESTION_TOOL_NAME],
    });
    expect(registry.has(RESOLVE_WORKFLOW_QUESTION_TOOL_NAME)).toBe(false);
  });
});
