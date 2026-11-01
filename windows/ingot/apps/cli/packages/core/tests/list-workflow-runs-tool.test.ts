import { describe, expect, it } from "vitest";
import {
  LIST_WORKFLOW_RUNS_TOOL_NAME,
  ListWorkflowRunsOutputSchema,
  type DynamicWorkflowRunListItem,
  type DynamicWorkflowRunListQuery,
  type DynamicWorkflowRunListResult,
  type DynamicWorkflowRunPort,
} from "@origin-ai/cf-contracts";
import { PermissionService } from "../src/permission/service.js";
import { resolveRuntimePermissionCapability } from "../src/tool/executor/permission-capability.js";
import { listWorkflowRunsToolEntry } from "../src/tool/handlers/list-workflow-runs.js";
import { registerBuiltInTools } from "../src/tool/handlers/index.js";
import { createToolRegistry } from "../src/tool/registry.js";
import { expectV2CommonContract } from "./tool-contract-assertions.js";
import type { ToolExecutionContext, ToolHandlerFailure } from "../src/tool/types.js";

const RUNNING_ITEM: DynamicWorkflowRunListItem = {
  runId: "dwfrun-running",
  label: "nightly triage",
  labelSource: "name",
  status: "running",
  ownedByThisSession: true,
  createdAt: Date.UTC(2026, 7, 21, 9, 0, 0),
  updatedAt: Date.UTC(2026, 7, 21, 9, 5, 0),
  spentTokens: 1_204,
};

const STRANDED_ITEM: DynamicWorkflowRunListItem = {
  runId: "dwfrun-stranded",
  label: "// triage the failing tests",
  labelSource: "script",
  status: "running",
  ownedByThisSession: false,
  possiblyInterrupted: true,
  createdAt: Date.UTC(2026, 7, 20, 8, 0, 0),
  updatedAt: Date.UTC(2026, 7, 20, 8, 1, 0),
  spentTokens: 0,
};

function stubListPort(result: DynamicWorkflowRunListResult): {
  port: DynamicWorkflowRunPort;
  queries: DynamicWorkflowRunListQuery[];
} {
  const queries: DynamicWorkflowRunListQuery[] = [];
  const unreachable = (name: string) => () => {
    throw new Error(`stubListPort.${name} 不应被 ListWorkflowRuns handler 触及`);
  };
  return {
    port: {
      submit: unreachable("submit"),
      getTask: unreachable("getTask"),
      waitForTask: unreachable("waitForTask"),
      cancel: unreachable("cancel"),
      listEvents: unreachable("listEvents"),
      getRunDetail: unreachable("getRunDetail"),
      async listRuns(query) {
        queries.push(query);
        return result;
      },
    } as unknown as DynamicWorkflowRunPort,
    queries,
  };
}

function contextWith(port?: DynamicWorkflowRunPort): ToolExecutionContext {
  return {
    abortSignal: new AbortController().signal,
    sessionId: "sess_list_runs" as never,
    toolCallId: "toolu_list_runs",
    traceId: "trace_list_runs" as never,
    workingDirectory: "/workspace/project",
    workspaceRoot: "/workspace/project",
    ...(port === undefined ? {} : { dynamicWorkflowRunPort: port }),
  } as ToolExecutionContext;
}

async function call(
  input: unknown,
  port?: DynamicWorkflowRunPort,
): Promise<Record<string, unknown>> {
  return (await listWorkflowRunsToolEntry.handler(input, contextWith(port))) as Record<
    string,
    unknown
  >;
}

function asFailure(output: unknown): ToolHandlerFailure {
  const failure = output as ToolHandlerFailure;
  expect(failure.result).toBe(false);
  return failure;
}

describe("ListWorkflowRuns handler — capability absence", () => {
  it("returns a business failure when the run port is absent", () => {
    return call({}).then((output) => {
      const failure = asFailure(output);
      expect(failure.message).toContain("workflow_introspection_unavailable");
      expect(failure.message).toMatch(/this session/i);
    });
  });

  it("gives the same failure when the port exists without listRuns", async () => {
    const portWithoutMethod = {
      async submit() {
        throw new Error("unreachable");
      },
    } as unknown as DynamicWorkflowRunPort;

    const withoutPort = asFailure(await call({}));
    const withoutMethod = asFailure(await call({}, portWithoutMethod));

    expect(withoutMethod).toEqual(withoutPort);
  });

  it("keeps an empty project list distinguishable from a failure", async () => {
    const { port } = stubListPort({ runs: [] });
    const output = await call({}, port);

    expect("result" in output).toBe(false);
    expect(output).toEqual({ runs: [] });
    expect(ListWorkflowRunsOutputSchema.parse(output)).toEqual({ runs: [] });
  });
});

describe("ListWorkflowRuns handler — query", () => {
  it("always queries the session working directory with the default limit", async () => {
    const { port, queries } = stubListPort({ runs: [] });
    await call({}, port);

    expect(queries).toEqual([{ cwd: "/workspace/project", limit: 20 }]);
    expect("statuses" in queries[0]!).toBe(false);
  });

  it("passes an explicit limit and status filter through", async () => {
    const { port, queries } = stubListPort({ runs: [] });
    await call({ limit: 5, statuses: ["running", "pending"] }, port);

    expect(queries).toEqual([
      { cwd: "/workspace/project", limit: 5, statuses: ["running", "pending"] },
    ]);
  });

  it("clamps an out-of-range limit before it reaches the port", async () => {
    const { port, queries } = stubListPort({ runs: [] });
    await call({ limit: 5_000 }, port);
    await call({ limit: 0 }, port);

    expect(queries.map((query) => query.limit)).toEqual([50, 1]);
  });
});

describe("ListWorkflowRuns handler — projection", () => {
  it("passes the cooked label, ownership and truncation flag through unchanged", async () => {
    const { port } = stubListPort({ runs: [RUNNING_ITEM, STRANDED_ITEM], truncated: true });
    const output = await call({}, port);

    expect(ListWorkflowRunsOutputSchema.parse(output)).toEqual({
      runs: [RUNNING_ITEM, STRANDED_ITEM],
      truncated: true,
    });
  });

  it("omits truncated and possiblyInterrupted instead of reporting them as false", async () => {
    const { port } = stubListPort({ runs: [RUNNING_ITEM] });
    const output = (await call({}, port)) as { runs: Array<Record<string, unknown>> };

    expect("truncated" in output).toBe(false);
    expect("possiblyInterrupted" in output.runs[0]!).toBe(false);
  });
});

describe("ListWorkflowRuns model content", () => {
  it("renders one line per run with ISO timestamps", () => {
    const content = String(
      listWorkflowRunsToolEntry.formatModelContent?.({
        runs: [RUNNING_ITEM, STRANDED_ITEM],
        truncated: true,
      }),
    );
    const lines = content.split("\n");

    expect(lines[0]).toBe('<workflow_runs count="2" truncated="true">');
    expect(lines.at(-1)).toBe("</workflow_runs>");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('id="dwfrun-running"');
    expect(lines[1]).toContain('status="running"');
    expect(lines[1]).toContain('label="nightly triage"');
    expect(lines[1]).toContain('owned_by_this_session="true"');
    expect(lines[1]).toContain('spent_tokens="1204"');
    expect(lines[1]).toContain('updated_at="2026-08-21T09:05:00.000Z"');
    expect(lines[1]).not.toContain("possibly_interrupted");
    expect(lines[2]).toContain('possibly_interrupted="true"');
  });

  it("says so in words when the project has no runs", () => {
    const content = String(listWorkflowRunsToolEntry.formatModelContent?.({ runs: [] }));

    expect(content).toContain('count="0"');
    expect(content).toMatch(/no workflow runs/i);
  });

  it("escapes a label that would otherwise break out of the attribute", () => {
    const content = String(
      listWorkflowRunsToolEntry.formatModelContent?.({
        runs: [{ ...RUNNING_ITEM, label: 'ship "it" & <now>\nsecond line' }],
      }),
    );

    expect(content).toContain('label="ship &quot;it&quot; &amp; &lt;now&gt; second line"');
    expect(content.split("\n")).toHaveLength(3);
  });

  it("reports an invalid result instead of throwing", () => {
    expect(String(listWorkflowRunsToolEntry.formatModelContent?.({ runs: "many" }))).toContain(
      "invalid result",
    );
  });
});

describe("ListWorkflowRuns declaration", () => {
  it("declares a read-only, no-side-effect capability consistently on both faces", () => {
    expect(listWorkflowRunsToolEntry.metadata).toMatchObject({
      name: LIST_WORKFLOW_RUNS_TOOL_NAME,
      readOnly: true,
      destructive: false,
      concurrentSafe: true,
      needsApproval: false,
      sideEffectScope: "none",
      riskLevel: "low",
      timeoutMs: 10_000,
    });
    expect(listWorkflowRunsToolEntry.permission).toMatchObject({
      permission: "listWorkflowRuns",
      needsApproval: false,
      sideEffectScope: "none",
      riskLevel: "low",
      denyPriority: "beforeAsk",
    });
    expect(listWorkflowRunsToolEntry.permission.alwaysAsk).toBeUndefined();
  });

  it("budgets the list for truncation rather than an artifact", () => {
    expect(listWorkflowRunsToolEntry.resultBudget).toMatchObject({
      maxInlineBytes: 24_000,
      maxModelBytes: 24_000,
      strategy: "truncate",
      preview: { direction: "head" },
    });
  });

  it("declares the v2 common contract", () => {
    expectV2CommonContract(listWorkflowRunsToolEntry);
  });

  it("steers the model away from polling in-flight runs", () => {
    const description = listWorkflowRunsToolEntry.metadata.description ?? "";

    expect(description).toMatch(/do not poll/i);
    expect(description).toMatch(/notification/i);
    expect(description).toMatch(/other sessions|across sessions|another session/i);
    expect(description).toContain("GetWorkflowRun");
  });

  it("cross-references ResumeWorkflowRun for the resumable states", () => {
    const description = listWorkflowRunsToolEntry.metadata.description ?? "";

    expect(description).toContain("ResumeWorkflowRun");
    expect(description).toMatch(/cancel/i);
    expect(description).toContain("interrupted");
    expect(description).toMatch(/only when the user asks/i);
  });

  it("cross-references AmendWorkflow for any run, running included", () => {
    const description = listWorkflowRunsToolEntry.metadata.description ?? "";

    expect(description).toContain("AmendWorkflow");
    expect(description).not.toContain("resume_from");
    expect(description).toMatch(/revised/i);
    expect(description).toMatch(/completed, stopped, errored, or still running/i);
    expect(description).toContain("superseded");
  });
});

describe("ListWorkflowRuns registration", () => {
  it("is always on, with no gate option", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry);

    expect(registry.has(LIST_WORKFLOW_RUNS_TOOL_NAME)).toBe(true);
    expect(registry.toContracts().map((tool) => tool.name)).toContain(
      LIST_WORKFLOW_RUNS_TOOL_NAME,
    );
  });

  for (const mode of ["plan", "build", "yolo"] as const) {
    it(`is auto-allowed in ${mode} mode`, () => {
      const capability = resolveRuntimePermissionCapability(listWorkflowRunsToolEntry, {}, {
        workingDirectory: "/workspace/project",
        workspaceRoot: "/workspace/project",
      } as never);

      expect(
        new PermissionService().checkPermission(
          { input: {}, mode, riskLevel: "low", toolName: LIST_WORKFLOW_RUNS_TOOL_NAME },
          capability,
        ),
      ).toMatchObject({ allowed: true, decision: "allow" });
    });
  }
});
