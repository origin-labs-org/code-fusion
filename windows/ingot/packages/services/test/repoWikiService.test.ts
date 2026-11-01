import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRepoWikiService } from "../src/repo-wiki/repoWikiService.js";

const workspaces: string[] = [];

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cf-repo-wiki-"));
  workspaces.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture-app", scripts: { test: "vitest run" } }),
  );
  await writeFile(join(root, "README.md"), "# Fixture App\n\nA tiny fixture workspace.\n");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src", "index.ts"),
    "export function main() {\n  return 'hello';\n}\n",
  );
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "docs", "guide.md"), "# Guide\n");
  return root;
}

const modelView = {
  providers: [
    {
      providerId: "openrouter",
      providerName: "OpenRouter",
      models: [{ modelId: "some/paid-model" }, { modelId: "some/model:free" }],
    },
  ],
};

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repo wiki service", () => {
  it("generates markdown pages and exposes them through a snapshot", async () => {
    const workspacePath = await createWorkspace();
    const generateText = vi.fn(async ({ prompt }: { prompt: string }) => ({
      text: `# Page\n\nGenerated from a ${prompt.length} character prompt.\n`,
    }));
    const service = createRepoWikiService({
      textGenerator: { generateText },
      readModelView: async () => modelView as never,
    });

    const started = await service.generate({ workspacePath, freeOnly: true });
    expect(started.snapshot.status).toBe("initializing");

    await vi.waitFor(
      async () => {
        const snapshot = await service.getSnapshot({ workspacePath });
        expect(snapshot.status).toBe("ready");
      },
      { timeout: 10_000 },
    );

    const snapshot = await service.getSnapshot({ workspacePath });
    expect(snapshot.pages.map((page) => page.slug)).toEqual(
      expect.arrayContaining(["overview", "architecture", "tech-stack", "conventions"]),
    );
    expect(snapshot.stats.fileCount).toBeGreaterThan(0);
    expect(snapshot.stats.model).toMatchObject({
      providerId: "openrouter",
      modelId: "some/model:free",
      free: true,
    });

    const page = await service.readPage({ workspacePath, slug: "overview" });
    expect(page.page.markdown).toContain("# Page");
    expect(generateText).toHaveBeenCalledTimes(snapshot.pages.length);
  });

  it("rejects free-only generation when no free model is configured", async () => {
    const workspacePath = await createWorkspace();
    const service = createRepoWikiService({
      textGenerator: { generateText: vi.fn() },
      readModelView: async () =>
        ({
          providers: [
            { providerId: "openrouter", models: [{ modelId: "some/paid-model" }] },
          ],
        }) as never,
    });

    await expect(service.generate({ workspacePath, freeOnly: true })).rejects.toThrow(
      "no_free_model_available",
    );
  });

  it("marks free and local models in the model list", async () => {
    const workspacePath = await createWorkspace();
    const service = createRepoWikiService({
      textGenerator: { generateText: vi.fn() },
      readModelView: async () =>
        ({
          preferredSelection: { providerId: "openrouter", modelId: "some/paid-model" },
          providers: [
            {
              providerId: "openrouter",
              models: [{ modelId: "some/paid-model" }, { modelId: "some/model:free" }],
            },
            { providerId: "ollama", models: [{ modelId: "llama3" }] },
          ],
        }) as never,
    });

    const result = await service.listModels({ workspacePath });
    const byId = new Map(result.models.map((model) => [model.modelId, model]));
    expect(byId.get("some/model:free")?.free).toBe(true);
    expect(byId.get("llama3")?.free).toBe(true);
    expect(byId.get("some/paid-model")?.free).toBe(false);
    expect(byId.get("some/paid-model")?.selected).toBe(true);
    expect(result.preferred).toEqual({ providerId: "openrouter", modelId: "some/paid-model" });
  });

  it("reports an absent snapshot for a workspace without a wiki", async () => {
    const workspacePath = await createWorkspace();
    const service = createRepoWikiService({
      textGenerator: { generateText: vi.fn() },
      readModelView: async () => null,
    });
    const snapshot = await service.getSnapshot({ workspacePath });
    expect(snapshot.status).toBe("absent");
    expect(snapshot.pages).toHaveLength(0);
  });
});
