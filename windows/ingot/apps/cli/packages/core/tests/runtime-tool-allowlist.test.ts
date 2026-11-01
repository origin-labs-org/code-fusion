import {
  AMEND_WORKFLOW_TOOL_NAME,
  CREATE_WORKFLOW_TOOL_NAME,
  EVAL_WORKFLOW_SNIPPET_TOOL_NAME,
  GET_WORKFLOW_RUN_TOOL_NAME,
  LIST_MODELS_TOOL_NAME,
  LIST_SAVED_WORKFLOWS_TOOL_NAME,
  LIST_WORKFLOW_RUNS_TOOL_NAME,
  FILL_WORKFLOW_HOLE_TOOL_NAME,
  RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
  RESPOND_TO_COORDINATOR_TOOL_NAME,
  RESUME_WORKFLOW_RUN_TOOL_NAME,
  SAVE_WORKFLOW_TOOL_NAME,
} from "@origin-ai/cf-contracts";
import { createSessionId } from "@origin-ai/cf-contracts";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../src/runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { EXPLORE_AGENT_ALLOWED_TOOLS } from "../src/subagent/explore-tools.js";
import {
  resolveBuiltInToolAllowlist,
  resolveRuntimeDisallowedTools,
} from "../src/runtime/helpers/tool-allowlist.js";
import { registerBuiltInTools } from "../src/tool/handlers/index.js";
import { createToolRegistry } from "../src/tool/registry.js";
import type { AgentRuntimeConfig } from "../src/runtime/types.js";

function config(patch: Partial<AgentRuntimeConfig>): AgentRuntimeConfig {
  return patch as AgentRuntimeConfig;
}

describe("resolveBuiltInToolAllowlist", () => {
  it("keeps RespondToCoordinator after the Explore child intersection", () => {
    expect(
      resolveBuiltInToolAllowlist(
        config({
          taskType: "subagent_child",
          toolset: "explore",
          toolAllowlist: [...EXPLORE_AGENT_ALLOWED_TOOLS, RESPOND_TO_COORDINATOR_TOOL_NAME],
        }),
      ),
    ).toContain(RESPOND_TO_COORDINATOR_TOOL_NAME);
  });

  it("does not add RespondToCoordinator to a main Explore runtime", () => {
    expect(
      resolveBuiltInToolAllowlist(
        config({
          toolset: "explore",
          toolAllowlist: [...EXPLORE_AGENT_ALLOWED_TOOLS, RESPOND_TO_COORDINATOR_TOOL_NAME],
        }),
      ),
    ).not.toContain(RESPOND_TO_COORDINATOR_TOOL_NAME);
  });

  it("adds RespondToCoordinator to a custom child allowlist", () => {
    expect(
      resolveBuiltInToolAllowlist(
        config({
          taskType: "subagent_child",
          toolset: "main",
          toolAllowlist: ["Read"],
        }),
      ),
    ).toEqual(["Read", RESPOND_TO_COORDINATOR_TOOL_NAME]);
  });

  it("keeps an unrestricted general child allowlist unrestricted", () => {
    expect(
      resolveBuiltInToolAllowlist(config({ taskType: "subagent_child", toolset: "main" })),
    ).toBeUndefined();
  });

  it("keeps an unrestricted workflow child allowlist unrestricted", () => {
    expect(
      resolveBuiltInToolAllowlist(config({ taskType: "workflow_child", toolset: "main" })),
    ).toBeUndefined();
  });

  it("keeps a custom main allowlist unchanged", () => {
    expect(
      resolveBuiltInToolAllowlist(config({ toolset: "main", toolAllowlist: ["Read"] })),
    ).toEqual(["Read"]);
  });
});

describe("resolveRuntimeDisallowedTools", () => {
  it("excludes the always-ask workflow tools from workflow-child runtimes", () => {
    const disallowed = resolveRuntimeDisallowedTools(config({ taskType: "workflow_child" }));
    expect(disallowed).toEqual([
      CREATE_WORKFLOW_TOOL_NAME,
      AMEND_WORKFLOW_TOOL_NAME,
      SAVE_WORKFLOW_TOOL_NAME,
      RESUME_WORKFLOW_RUN_TOOL_NAME,
      RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
      FILL_WORKFLOW_HOLE_TOOL_NAME,
    ]);
  });

  it("merges with an existing turn disallowlist instead of replacing it", () => {
    expect(
      resolveRuntimeDisallowedTools(
        config({ taskType: "workflow_child", toolDisallowlist: ["CronCreate"] }),
      ),
    ).toEqual([
      "CronCreate",
      CREATE_WORKFLOW_TOOL_NAME,
      AMEND_WORKFLOW_TOOL_NAME,
      SAVE_WORKFLOW_TOOL_NAME,
      RESUME_WORKFLOW_RUN_TOOL_NAME,
      RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
      FILL_WORKFLOW_HOLE_TOOL_NAME,
    ]);
  });

  it("does not duplicate an already disallowed CreateWorkflow", () => {
    expect(
      resolveRuntimeDisallowedTools(
        config({ taskType: "workflow_child", toolDisallowlist: [CREATE_WORKFLOW_TOOL_NAME] }),
      ),
    ).toEqual([
      CREATE_WORKFLOW_TOOL_NAME,
      AMEND_WORKFLOW_TOOL_NAME,
      SAVE_WORKFLOW_TOOL_NAME,
      RESUME_WORKFLOW_RUN_TOOL_NAME,
      RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
      FILL_WORKFLOW_HOLE_TOOL_NAME,
    ]);
  });

  it("leaves other task types on their configured disallowlist", () => {
    expect(resolveRuntimeDisallowedTools(config({ taskType: "subagent_child" }))).toBeUndefined();
    expect(resolveRuntimeDisallowedTools(config({ toolDisallowlist: ["CronCreate"] }))).toEqual([
      "CronCreate",
    ]);
  });

  it("keeps ResolveWorkflowQuestion out of every workflow child, whatever the persona profile", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, {
      disallowedTools: resolveRuntimeDisallowedTools(config({ taskType: "workflow_child" })),
    });
    expect(registry.has(RESOLVE_WORKFLOW_QUESTION_TOOL_NAME)).toBe(false);
  });

  it("registers ResolveWorkflowQuestion in a main runtime but not in an actor session", () => {
    const mainRegistry = createToolRegistry();
    registerBuiltInTools(mainRegistry, {
      disallowedTools: resolveRuntimeDisallowedTools(config({})),
    });
    expect(mainRegistry.has(RESOLVE_WORKFLOW_QUESTION_TOOL_NAME)).toBe(true);

    const actorRegistry = createToolRegistry();
    registerBuiltInTools(actorRegistry, {
      disallowedTools: resolveRuntimeDisallowedTools(
        config({
          taskType: "workflow_child",
          toolDisallowlist: [RESOLVE_WORKFLOW_QUESTION_TOOL_NAME],
        }),
      ),
    });
    expect(actorRegistry.has(RESOLVE_WORKFLOW_QUESTION_TOOL_NAME)).toBe(false);
  });

  it("keeps the tool out of the registry for a workflow child but not for a main runtime", () => {
    const childRegistry = createToolRegistry();
    registerBuiltInTools(childRegistry, {
      disallowedTools: resolveRuntimeDisallowedTools(config({ taskType: "workflow_child" })),
    });
    expect(childRegistry.has(CREATE_WORKFLOW_TOOL_NAME)).toBe(false);
    expect(childRegistry.has(RESUME_WORKFLOW_RUN_TOOL_NAME)).toBe(false);

    const mainRegistry = createToolRegistry();
    registerBuiltInTools(mainRegistry, {
      disallowedTools: resolveRuntimeDisallowedTools(config({})),
    });
    expect(mainRegistry.has(CREATE_WORKFLOW_TOOL_NAME)).toBe(true);
    expect(mainRegistry.has(RESUME_WORKFLOW_RUN_TOOL_NAME)).toBe(true);
  });
});

// docs/dynamic-workflow/launch.md「Gray release」DWG-03 / DWG-04。
const GATED_DYNAMIC_WORKFLOW_TOOL_NAMES = [
  CREATE_WORKFLOW_TOOL_NAME,
  AMEND_WORKFLOW_TOOL_NAME,
  SAVE_WORKFLOW_TOOL_NAME,
  LIST_SAVED_WORKFLOWS_TOOL_NAME,
  LIST_MODELS_TOOL_NAME,
  EVAL_WORKFLOW_SNIPPET_TOOL_NAME,
  LIST_WORKFLOW_RUNS_TOOL_NAME,
  GET_WORKFLOW_RUN_TOOL_NAME,
  RESUME_WORKFLOW_RUN_TOOL_NAME,
  RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
  FILL_WORKFLOW_HOLE_TOOL_NAME,
];

describe("registerBuiltInTools：动态Workflow灰度门", () => {
  const GATED_TOOL_NAMES = GATED_DYNAMIC_WORKFLOW_TOOL_NAMES;

  it("includeDynamicWorkflow:false 时十个ToolsOne个都不注册", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, { includeDynamicWorkflow: false });
    for (const name of GATED_TOOL_NAMES) {
      expect({ name, registered: registry.has(name) }).toEqual({ name, registered: false });
    }
  });

  it("关门与开门的差集恰OKYes十个，不多剃One件Tools", () => {
    const enabled = createToolRegistry();
    registerBuiltInTools(enabled, { includeDynamicWorkflow: true, includeWorkflow: true });
    const disabled = createToolRegistry();
    registerBuiltInTools(disabled, { includeDynamicWorkflow: false, includeWorkflow: true });

    const registeredWhenDisabled = new Set(disabled.list());
    expect(
      enabled
        .list()
        .filter((name) => !registeredWhenDisabled.has(name))
        .toSorted(),
    ).toEqual([...GATED_TOOL_NAMES].toSorted());
  });

  it.each([{ includeDynamicWorkflow: undefined }, { includeDynamicWorkflow: true }])(
    "缺席or true 时十个ToolsAll注册：%j",
    (options) => {
      const registry = createToolRegistry();
      registerBuiltInTools(registry, options);
      for (const name of GATED_TOOL_NAMES) {
        expect({ name, registered: registry.has(name) }).toEqual({ name, registered: true });
      }
    },
  );
});

describe("AgentRuntime：dynamicWorkflowEnabled 到Tools注册表", () => {
  it.each([
    { config: { dynamicWorkflowEnabled: false }, registered: false },
    { config: { dynamicWorkflowEnabled: true }, registered: true },
    { config: {}, registered: true },
  ])("config %j", ({ config: runtimeConfig, registered }) => {
    const registry = createToolRegistry();
    new AgentRuntime(createSessionId("gray-release"), runtimeConfig, {
      eventStore: createTestSessionEventStore(),
      toolRegistry: registry,
    });
    expect(registry.has(CREATE_WORKFLOW_TOOL_NAME)).toBe(registered);
    expect(registry.has(RESOLVE_WORKFLOW_QUESTION_TOOL_NAME)).toBe(registered);
  });
});

describe("AgentRuntime：分支Refresh后灰度门仍然成立", () => {
  const CMD_SHELL_SELECTION = {
    dialect: "cmd",
    display: { name: "CMD" },
    id: "cmd",
    label: "CMD",
    path: "cmd.exe",
    source: "user-config",
  } as const;

  it.each([
    { config: { dynamicWorkflowEnabled: false }, registered: false },
    { config: { dynamicWorkflowEnabled: true }, registered: true },
    { config: {}, registered: true },
  ])("config %j", ({ config: runtimeConfig, registered }) => {
    const runtime = new AgentRuntime(createSessionId("gray-release-refresh"), runtimeConfig, {
      eventStore: createTestSessionEventStore(),
      toolRegistry: createToolRegistry(),
    });
    expect(runtime.getToolRegistry().has(CREATE_WORKFLOW_TOOL_NAME)).toBe(registered);

    expect(runtime.initializeSessionShellEnvironmentIfNeeded(CMD_SHELL_SELECTION)).toBe(true);

    const registry = runtime.getToolRegistry();
    for (const name of GATED_DYNAMIC_WORKFLOW_TOOL_NAMES) {
      expect({ name, registered: registry.has(name) }).toEqual({ name, registered });
    }
    expect(registry.has("Read")).toBe(true);
  });
});

describe("Agent / Task 描述随灰度门增删Workflow那One行", () => {
  function descriptionsOf(options: { includeDynamicWorkflow?: boolean }): {
    agent: string;
    task: string;
  } {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, { includeAgent: true, ...options });
    const agent = registry.get("Agent")?.metadata.description ?? "";
    const task = registry.get("Task")?.metadata.description ?? "";
    return { agent, task };
  }

  it("Close时 Agent 与 Task 的描述都不再提 CreateWorkflow", () => {
    const { agent, task } = descriptionsOf({ includeDynamicWorkflow: false });
    expect(agent).not.toContain("CreateWorkflow");
    expect(task).not.toContain("CreateWorkflow");
    expect(agent).toContain("Launch a new agent");
    expect(task).toContain("Claude Code-compatible alias");
  });

  it.each([{ includeDynamicWorkflow: true }, {}])("开启or缺席时那One行Retain：%j", (options) => {
    const { agent, task } = descriptionsOf(options);
    expect(agent).toContain("CreateWorkflow");
    expect(task).toContain("CreateWorkflow");
  });
});
