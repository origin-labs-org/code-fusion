import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cfSkillsReferenceCatalogResultSchema } from "@origin-ai/cf-shared";
import type { SkillLoadOutcome } from "@origin-ai/cf-contracts";
import { getSkillReferenceCatalog } from "../src/cf-protocol/skill-reference-catalog.js";
import type {
  CfProtocolAgentServerContext,
  CfProtocolSessionRecord,
} from "../src/cf-protocol/server-types.js";

const SESSION_CATALOG: SkillLoadOutcome = {
  skills: [
    {
      name: "frozen",
      description: "Frozen session skill",
      path: "/workspace/.cf/skills/frozen/SKILL.md",
      directory: "/workspace/.cf/skills/frozen",
      rootPath: "/workspace/.cf/skills",
      scope: "project",
      source: "cf",
      safeToAutoLoad: true,
      frontmatterKeys: ["name", "description"],
    },
  ],
  diagnostics: [],
  totalDiscovered: 1,
};

function contextWithSession(sessionId: string): CfProtocolAgentServerContext {
  const record = {
    app: {
      getSkillCatalog: async () => SESSION_CATALOG,
    },
  } as unknown as CfProtocolSessionRecord;
  return {
    deps: { env: {} },
    sessions: new Map([[sessionId, record]]),
  } as unknown as CfProtocolAgentServerContext;
}

describe("skills/referenceCatalog protocol", () => {
  it("serves the Session runtime frozen catalog", async () => {
    const result = await getSkillReferenceCatalog(contextWithSession("session-a"), {
      workspace: { workspacePath: "/workspace", workspaceKey: "/workspace" },
      sessionId: "session-a",
    });

    expect(result).toEqual({
      authority: "session",
      skills: [
        {
          id: "glm:workspace:/workspace/.cf/skills/frozen/SKILL.md",
          name: "frozen",
          description: "Frozen session skill",
          path: "/workspace/.cf/skills/frozen/SKILL.md",
          scope: "workspace",
          enabled: true,
        },
      ],
    });
    expect(() => cfSkillsReferenceCatalogResultSchema.parse(result)).not.toThrow();
  });

  it("fails closed for an unknown Session instead of falling back to workspace discovery", async () => {
    await expect(
      getSkillReferenceCatalog(contextWithSession("session-a"), {
        workspace: { workspacePath: "/workspace", workspaceKey: "/workspace" },
        sessionId: "missing",
      }),
    ).rejects.toThrow(/Session is not active/);
  });

  it("rescans the current workspace catalog for a draft request", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-skill-reference-workspace-"));
    const skillDirectory = join(root, ".cf", "skills", "manual-added");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(
      join(skillDirectory, "SKILL.md"),
      ["---", "name: manual-added", "description: Added outside the app.", "---"].join("\n"),
    );
    try {
      const result = await getSkillReferenceCatalog(
        {
          deps: {
            env: {
              HOME: root,
              CF_STORAGE_DIR: join(root, "cli"),
            },
          },
          sessions: new Map(),
        } as unknown as CfProtocolAgentServerContext,
        { workspace: { workspacePath: root, workspaceKey: root } },
      );

      expect(result.authority).toBe("workspace");
      expect(result.skills).toContainEqual(
        expect.objectContaining({
          name: "manual-added",
          description: "Added outside the app.",
          scope: "workspace",
          enabled: true,
        }),
      );
      expect(() => cfSkillsReferenceCatalogResultSchema.parse(result)).not.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
