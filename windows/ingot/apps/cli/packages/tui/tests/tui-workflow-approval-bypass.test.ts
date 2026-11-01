//
import assert from "node:assert/strict";
import test from "node:test";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  CREATE_WORKFLOW_TOOL_NAME,
  type PermissionBrokerRequest,
} from "@origin-ai/cf-contracts";
import { createTuiPermissionRequester } from "../src/app-permission.js";
import type { ApprovalPrompt } from "../src/app-model.js";

function permissionRequest(
  overrides: Partial<PermissionBrokerRequest> = {},
): PermissionBrokerRequest {
  return {
    toolCallId: "tc-1",
    toolName: "Bash",
    riskLevel: "low",
    reason: "needs approval",
    input: { command: "ls" },
    ...overrides,
  } as PermissionBrokerRequest;
}

function trackedRequester() {
  const enqueued: ApprovalPrompt[] = [];
  let statusCalls = 0;
  const requestPermission = createTuiPermissionRequester({
    setApprovalQueue: ((update: unknown) => {
      const next =
        typeof update === "function"
          ? (update as (current: ApprovalPrompt[]) => ApprovalPrompt[])([...enqueued])
          : (update as ApprovalPrompt[]);
      enqueued.length = 0;
      enqueued.push(...next);
    }) as Parameters<typeof createTuiPermissionRequester>[0]["setApprovalQueue"],
    setStatus: () => {
      statusCalls += 1;
    },
  });
  return { enqueued, requestPermission, statusCalls: () => statusCalls };
}

test("CreateWorkflow is auto-allowed without ever enqueuing an approval panel", async () => {
  const { enqueued, requestPermission, statusCalls } = trackedRequester();

  const result = await requestPermission(
    permissionRequest({ toolName: CREATE_WORKFLOW_TOOL_NAME, input: { source: "workflow {}" } }),
  );

  assert.equal(result.decision, "allow");
  assert.deepEqual(enqueued, []);
  assert.equal(statusCalls(), 0);
});

test("the CreateWorkflow bypass persists no permission rule", async () => {
  const { requestPermission } = trackedRequester();

  const result = await requestPermission(
    permissionRequest({
      toolName: CREATE_WORKFLOW_TOOL_NAME,
      suggestedPermissionUpdates: [
        { type: "addRules", behavior: "allow", rules: [{ toolName: CREATE_WORKFLOW_TOOL_NAME }] },
      ],
    } as Partial<PermissionBrokerRequest>),
  );

  assert.equal(result.decision, "allow");
  assert.equal(result.permissionUpdates, undefined);
});

test("other tools still raise an approval panel and stay pending", async () => {
  const { enqueued, requestPermission } = trackedRequester();

  let settled = false;
  void requestPermission(permissionRequest({ toolName: "Bash" })).then(() => {
    settled = true;
  });
  await Promise.resolve();

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0]?.request.toolName, "Bash");
  assert.equal(settled, false, "a non-workflow tool must not be auto-allowed");
});

test("AskUserQuestion keeps its question-panel path", async () => {
  const { enqueued, requestPermission } = trackedRequester();

  void requestPermission(
    permissionRequest({
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      input: {
        questions: [
          {
            question: "Which approach?",
            header: "Approach",
            options: [
              { label: "A", description: "First approach" },
              { label: "B", description: "Second approach" },
            ],
          },
        ],
      },
    }),
  );
  await Promise.resolve();

  assert.equal(enqueued.length, 1);
  assert.ok(enqueued[0]?.questionState, "AskUserQuestion should still build question state");
});

test("an already-aborted request rejects before the bypass can allow it", async () => {
  const { enqueued, requestPermission } = trackedRequester();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    requestPermission(permissionRequest({ toolName: CREATE_WORKFLOW_TOOL_NAME }), {
      signal: controller.signal,
    }),
    /cancelled/u,
  );
  assert.deepEqual(enqueued, []);
});
