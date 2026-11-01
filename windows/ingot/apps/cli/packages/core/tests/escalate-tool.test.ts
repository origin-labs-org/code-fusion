import {
  CoreErrorType,
  ESCALATE_TOOL_NAME,
  createRootTraceContext,
  createSessionId,
  createToolCallId,
  createTurnId,
  isCoreError,
  type EscalateQuestionRequest,
  type WorkflowEscalatePort,
} from "@origin-ai/cf-contracts";
import { describe, expect, it } from "vitest";
import { PermissionService, defaultPermissionConfig } from "../src/permission/service.js";
import { createToolExecutor } from "../src/tool/executor.js";
import { escalateToolEntry } from "../src/tool/handlers/escalate.js";
import { registerBuiltInTools } from "../src/tool/handlers/index.js";
import { createToolRegistry } from "../src/tool/registry.js";
import type { ToolExecutionContext } from "../src/tool/types.js";

function answeringPort(answer: string, qid = "dwfq-abc12345-1"): WorkflowEscalatePort {
  return { escalate: async () => ({ kind: "answered", answer, qid }) };
}

function toolContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    abortSignal: new AbortController().signal,
    sessionId: "sess_escalate" as never,
    toolCallId: "tool_escalate",
    traceId: "trace_escalate" as never,
    workingDirectory: "/tmp",
    workspaceRoot: "/tmp",
    ...overrides,
  };
}

function escalateExecutor(port: WorkflowEscalatePort | undefined) {
  const sessionId = createSessionId("escalate-exec");
  const turnId = createTurnId("escalate-exec");
  const traceContext = createRootTraceContext({ sessionId, turnId });
  const registry = createToolRegistry();
  registry.register(escalateToolEntry);
  const executor = createToolExecutor({
    emitEvent: async () => undefined,
    permissionService: new PermissionService(defaultPermissionConfig),
    registry,
    workflowEscalatePort: port,
    sessionId,
    turnId,
    traceContext,
  });
  return { executor, traceContext };
}

describe("escalate handler", () => {
  it("returns the main agent's answer verbatim on the answered branch", async () => {
    const seen: EscalateQuestionRequest[] = [];
    const port: WorkflowEscalatePort = {
      escalate: async (request) => {
        seen.push(request);
        return { kind: "answered", answer: "Treat 95 as passing.", qid: "dwfq-abc12345-1" };
      },
    };

    const output = await escalateToolEntry.handler(
      { question: "The gate is capped at 95 but requires 96.", context: "6 attempts, all 95." },
      toolContext({ workflowEscalatePort: port, toolCallId: "call_7" }),
    );

    expect(output).toEqual({
      status: "answered",
      message: "Treat 95 as passing.",
      qid: "dwfq-abc12345-1",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.toolCallId).toBe("call_7");
    expect(seen[0]?.question).toBe("The gate is capped at 95 but requires 96.");
    expect(seen[0]?.context).toBe("6 attempts, all 95.");
    expect(seen[0]?.trace.traceId).toBe("trace_escalate");
  });

  it("omits context entirely when the actor did not give one", async () => {
    const seen: EscalateQuestionRequest[] = [];
    const port: WorkflowEscalatePort = {
      escalate: async (request) => {
        seen.push(request);
        return { kind: "answered", answer: "yes", qid: "dwfq-abc12345-2" };
      },
    };

    await escalateToolEntry.handler(
      { question: "Ship it?" },
      toolContext({ workflowEscalatePort: port }),
    );

    expect(seen[0] && "context" in seen[0]).toBe(false);
  });

  it.each([
    ["budget_exhausted", "升级预算已尽，请自行以最佳判断推进。"],
    ["no_active_ask", "当前没有在飞的 ask，升级的问题无处停驻，也不会有人作答。"],
  ] as const)(
    "renders the %s refusal as an ordinary result carrying the port's message",
    async (reason, message) => {
      const port: WorkflowEscalatePort = {
        escalate: async () => ({ kind: "refused", reason, message }),
      };

      const output = await escalateToolEntry.handler(
        { question: "anything" },
        toolContext({ workflowEscalatePort: port }),
      );

      expect(output).toEqual({ status: "refused", message, reason });
    },
  );

  it("rejects an input without a question", async () => {
    await expect(
      escalateToolEntry.handler(
        { context: "no question here" },
        toolContext({
          workflowEscalatePort: answeringPort("unused"),
        }),
      ),
    ).rejects.toThrow();
  });

  it("throws a non-recoverable ConfigurationError when no escalate port is configured", async () => {
    let caught: unknown;
    try {
      await escalateToolEntry.handler({ question: "blocked" }, toolContext());
    } catch (error) {
      caught = error;
    }
    expect(isCoreError(caught)).toBe(true);
    if (!isCoreError(caught)) throw new Error("expected a core error");
    expect(caught.type).toBe(CoreErrorType.ConfigurationError);
    expect(caught.recoverable).toBe(false);
  });
});

describe("escalate executor surface", () => {
  it("delivers the answer as the model-facing content and does NOT stop the turn", async () => {
    const { executor, traceContext } = escalateExecutor(answeringPort("Use the 95 cap."));

    const result = await executor.execute(
      {
        id: createToolCallId("escalate-answered"),
        input: { question: "impossible gate?" },
        name: ESCALATE_TOOL_NAME,
      },
      { traceContext },
    );

    expect(result.success).toBe(true);
    expect(result.modelContent).toBe("Use the 95 cap.");
    expect(result.turnControl).toBeUndefined();
  });

  it("surfaces a budget refusal as a SUCCESSFUL tool result, not an error", async () => {
    const message = "升级预算已尽，请自行以最佳判断推进。";
    const { executor, traceContext } = escalateExecutor({
      escalate: async () => ({ kind: "refused", reason: "budget_exhausted", message }),
    });

    const result = await executor.execute(
      {
        id: createToolCallId("escalate-refused"),
        input: { question: "again?" },
        name: ESCALATE_TOOL_NAME,
      },
      { traceContext },
    );

    expect(result.success).toBe(true);
    expect(result.modelContent).toBe(message);
  });
});

describe("escalate registration gate", () => {
  it("registers escalate only when includeEscalate is set", () => {
    const withPort = createToolRegistry();
    registerBuiltInTools(withPort, { includeEscalate: true });
    expect(withPort.has(ESCALATE_TOOL_NAME)).toBe(true);

    const withoutPort = createToolRegistry();
    registerBuiltInTools(withoutPort, {});
    expect(withoutPort.has(ESCALATE_TOOL_NAME)).toBe(false);
  });

  it("has no wall-clock timeout — an answer may take arbitrarily long", () => {
    expect(escalateToolEntry.timeout).toEqual({ kind: "none" });
    expect(escalateToolEntry.cancellation?.supported).toBe(true);
  });
});
