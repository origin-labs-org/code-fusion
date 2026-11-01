import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const { mkdtempSync } = await import("node:fs");
  const { join: joinPath } = await import("node:path");
  const fakeHome = mkdtempSync(joinPath(actual.tmpdir(), "cf-plugin-reference-home-"));
  (globalThis as { __pluginReferenceFakeHome?: string }).__pluginReferenceFakeHome = fakeHome;
  return { ...actual, homedir: () => fakeHome };
});

import {
  cfProtocolMethods,
  cfPluginsReferenceCatalogParamsSchema,
  cfPluginsReferenceCatalogResultSchema,
} from "@origin-ai/cf-shared";
import type { PluginReferenceCatalog } from "@origin-ai/cf-contracts";
import { getPluginReferenceCatalog } from "../src/cf-protocol/plugin-reference-catalog.js";
import type {
  CfProtocolAgentServerContext,
  CfProtocolSessionRecord,
} from "../src/cf-protocol/server-types.js";

afterAll(async () => {
  const fakeHome = (globalThis as { __pluginReferenceFakeHome?: string }).__pluginReferenceFakeHome;
  if (fakeHome) {
    await rm(fakeHome, { force: true, recursive: true });
  }
});

const SESSION_CATALOG: PluginReferenceCatalog = {
  plugins: [
    {
      pluginId: "frozen@mkt-a",
      name: "frozen",
      marketplace: "mkt-a",
      enabled: true,
      conflictingPluginIds: [],
      skillQualifiedNames: ["frozen:probe"],
      mcpServerNames: ["plugin:frozen:main"],
      subagentNames: ["frozen:reviewer"],
      rootPath: "/plugins/frozen",
    },
  ],
};

function contextWithSession(sessionId: string): CfProtocolAgentServerContext {
  const record = {
    app: {
      getPluginReferenceCatalog: () => SESSION_CATALOG,
    },
  } as unknown as CfProtocolSessionRecord;
  return {
    sessions: new Map([[sessionId, record]]),
  } as unknown as CfProtocolAgentServerContext;
}

describe("plugins/referenceCatalog protocol", () => {
  it("registers the protocol method and schemas", () => {
    expect(cfProtocolMethods.pluginsReferenceCatalog).toBe("plugins/referenceCatalog");
    expect(() =>
      cfPluginsReferenceCatalogParamsSchema.parse({
        workspace: { workspacePath: "/w", workspaceKey: "/w" },
        sessionId: "sess_x",
      }),
    ).not.toThrow();
    expect(() =>
      cfPluginsReferenceCatalogResultSchema.parse({
        authority: "workspace",
        plugins: [
          {
            pluginId: "demo@mkt",
            name: "demo",
            marketplace: "mkt",
            icon: "https://cdn.example.com/demo.png",
            displayName: "Demo Plugin",
            displayNameI18n: { "zh-CN": "演示插件" },
            description: "Demo description",
            descriptionI18n: { "zh-CN": "演示描述" },
            enabled: true,
            conflictingPluginIds: [],
            skillQualifiedNames: [],
            mcpServerNames: [],
            subagentNames: [],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("serves the session-owned frozen catalog when sessionId resolves (identifiers-only)", async () => {
    const result = await getPluginReferenceCatalog(contextWithSession("sess_a"), {
      workspace: { workspacePath: "/w", workspaceKey: "/w" },
      sessionId: "sess_a",
    });
    expect(result.authority).toBe("session");
    const enriched = await getPluginReferenceCatalog(
      contextWithSession("sess_a"),
      {
        workspace: { workspacePath: "/w", workspaceKey: "/w" },
        sessionId: "sess_a",
      },
      true,
    );
    expect(enriched.plugins.map((x) => x.pluginId)).toEqual(["frozen@mkt-a"]);
    expect(enriched.plugins[0]?.category).toBe("other");
    expect(result.plugins).toEqual([
      {
        pluginId: "frozen@mkt-a",
        name: "frozen",
        marketplace: "mkt-a",
        enabled: true,
        conflictingPluginIds: [],
        skillQualifiedNames: ["frozen:probe"],
        mcpServerNames: ["plugin:frozen:main"],
        subagentNames: ["frozen:reviewer"],
      },
    ]);
    expect(() => cfPluginsReferenceCatalogResultSchema.parse(result)).not.toThrow();
  });

  it("fails closed when the sessionId is unknown instead of falling back to workspace authority", async () => {
    await expect(
      getPluginReferenceCatalog(contextWithSession("sess_a"), {
        workspace: { workspacePath: "/w", workspaceKey: "/w" },
        sessionId: "sess_missing",
      }),
    ).rejects.toThrow(/Session is not active/);
  });

  it("serves the live workspace catalog when no sessionId is provided (draft picker)", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-plugin-reference-workspace-"));
    const previousStorageDir = process.env.CF_STORAGE_DIR;
    process.env.CF_STORAGE_DIR = join(root, "cli");
    try {
      const result = await getPluginReferenceCatalog({} as CfProtocolAgentServerContext, {
        workspace: { workspacePath: root, workspaceKey: root },
      });
      expect(result.authority).toBe("workspace");
      expect(() => cfPluginsReferenceCatalogResultSchema.parse(result)).not.toThrow();
      for (const entry of result.plugins) {
        expect(entry.pluginId).toBe(`${entry.name}@${entry.marketplace}`);
      }
      const cfGuide = result.plugins.find(
        (entry) => entry.pluginId === "cf-guide@cf-plugins-official",
      );
      expect(cfGuide?.icon).toBe(
        "https://cdn-cf.z.ai/cf/official-plugin/assets/cf-guide/icon.png",
      );
      expect(cfGuide?.category).toBeUndefined();
      const enriched = await getPluginReferenceCatalog(
        {} as CfProtocolAgentServerContext,
        {
          workspace: { workspacePath: root, workspaceKey: root },
        },
        true,
      );
      expect(enriched.plugins.find((x) => x.pluginId === cfGuide?.pluginId)?.category).toBe(
        "utilities",
      );
      expect(enriched.plugins.map((x) => x.pluginId)).toEqual(
        result.plugins.map((x) => x.pluginId),
      );
      expect(() => cfPluginsReferenceCatalogResultSchema.parse(enriched)).not.toThrow();
      expect(cfGuide?.displayName).toBe("CodeFusion Guide");
      expect(cfGuide?.displayNameI18n?.["zh-CN"]).toBe("CodeFusion 使用指南");
      expect(cfGuide?.description).toEqual(expect.any(String));
      expect(cfGuide?.descriptionI18n?.["zh-CN"]).toEqual(expect.any(String));
      expect(
        enriched.plugins.find((x) => x.pluginId === cfGuide?.pluginId)?.descriptionI18n,
      ).toEqual(cfGuide?.descriptionI18n);
    } finally {
      if (previousStorageDir === undefined) delete process.env.CF_STORAGE_DIR;
      else process.env.CF_STORAGE_DIR = previousStorageDir;
      await rm(root, { force: true, recursive: true });
    }
  });
});
