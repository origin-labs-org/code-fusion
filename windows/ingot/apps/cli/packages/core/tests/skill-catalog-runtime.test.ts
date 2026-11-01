import { describe, expect, it, vi } from "vitest";
import {
  createRootTraceContext,
  createSessionId,
  type SkillMetadata,
  type SkillPort,
} from "@origin-ai/cf-contracts";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";

function skill(name: string): SkillMetadata {
  const path = `/workspace/.cf/skills/${name}/SKILL.md`;
  return {
    name,
    description: `${name} description`,
    path,
    directory: `/workspace/.cf/skills/${name}`,
    rootPath: "/workspace/.cf/skills",
    scope: "project",
    source: "cf",
    safeToAutoLoad: true,
    frontmatterKeys: ["name", "description"],
  };
}

describe("AgentRuntime Skill catalog", () => {
  it("freezes discovery within one runtime and discovers again for a new runtime", async () => {
    let revision = "initial";
    const discoverSkills = vi.fn<SkillPort["discoverSkills"]>(async () => ({
      skills: [skill(revision)],
      diagnostics: [],
      totalDiscovered: 1,
    }));
    const skillPort: SkillPort = {
      discoverSkills,
      async loadSkill() {
        throw new Error("not needed");
      },
    };
    const firstSessionId = createSessionId("skill-catalog-runtime-a");
    const firstTrace = createRootTraceContext({ sessionId: firstSessionId });
    const firstRuntime = createTestAgentRuntime(
      firstSessionId,
      { workingDirectory: "/workspace" },
      {
        eventStore: createTestSessionEventStore(),
        skillPort,
        traceContext: firstTrace,
      },
    );

    expect((await firstRuntime.getSkillCatalog(firstTrace)).skills[0]?.name).toBe("initial");
    revision = "added-after-start";
    expect((await firstRuntime.getSkillCatalog(firstTrace)).skills[0]?.name).toBe("initial");
    expect(discoverSkills).toHaveBeenCalledTimes(1);

    const secondSessionId = createSessionId("skill-catalog-runtime-b");
    const secondTrace = createRootTraceContext({ sessionId: secondSessionId });
    const secondRuntime = createTestAgentRuntime(
      secondSessionId,
      { workingDirectory: "/workspace" },
      {
        eventStore: createTestSessionEventStore(),
        skillPort,
        traceContext: secondTrace,
      },
    );

    expect((await secondRuntime.getSkillCatalog(secondTrace)).skills[0]?.name).toBe(
      "added-after-start",
    );
    expect(discoverSkills).toHaveBeenCalledTimes(2);
  });
});
