import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describeMarketplacePlugin } from "../src/plugins/index.js";
import {
  loadMarketplaceManifestSync,
  normalizeAuthorValue,
  parseEntryStoreListing,
} from "../src/plugins/marketplace.js";

describe("marketplace store listing", () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  async function makeStorageRoot(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    cleanups.push(dir);
    return dir;
  }

  it("parses listing fields and top-level featured from a CDN-shaped manifest", async () => {
    const storageRoot = await makeStorageRoot("cf-marketplace-listing-");
    const marketplaceDir = join(storageRoot, "marketplaces", "cf-plugins-official");
    await mkdir(marketplaceDir, { recursive: true });
    await writeFile(
      join(marketplaceDir, "marketplace.json"),
      JSON.stringify({
        name: "cf-plugins-official",
        description: "Official CodeFusion plugins marketplace",
        featured: ["example-plugin", " ", 42, "another"],
        plugins: [
          {
            name: "example-plugin",
            description: "A minimal template plugin",
            description_i18n: { "zh-CN": "一个最小模板插件" },
            displayName: "Example Plugin",
            displayName_i18n: { "zh-CN": "示例插件" },
            version: "0.1.1",
            author: { name: "Z.ai", url: "https://z.ai" },
            category: "template",
            icon: "https://cdn-cf.z.ai/icons/example.png",
            homepage: "https://z.ai/plugins/example",
            privacyPolicy: "https://z.ai/privacy",
            termsOfService: "https://z.ai/terms",
            heroImage: "https://cdn-cf.z.ai/hero/example.png",
            examplePrompts: ["Try the example"],
            examplePrompts_i18n: { "zh-CN": ["试试这个示例"] },
            requiresPaidPlan: true,
            source: {
              source: "url",
              type: "zip",
              url: "https://cdn.example/x.zip",
              sha256: "a".repeat(64),
            },
          },
          {
            name: "bare-plugin",
            source: { source: "github", repo: "acme/bare-plugin" },
          },
          {
            name: "ambiguous-plan-plugin",
            requiresPaidPlan: "true",
            source: { source: "github", repo: "acme/ambiguous" },
          },
        ],
      }),
    );

    const manifest = loadMarketplaceManifestSync(storageRoot, "cf-plugins-official");
    expect(manifest).not.toBeNull();
    expect(manifest?.featured).toEqual(["example-plugin", "another"]);

    const example = manifest?.plugins.find((entry) => entry.name === "example-plugin");
    expect(example?.listing).toEqual({
      displayName: "Example Plugin",
      displayNameI18n: { "zh-CN": "示例插件" },
      descriptionI18n: { "zh-CN": "一个最小模板插件" },
      icon: "https://cdn-cf.z.ai/icons/example.png",
      category: "template",
      author: "Z.ai",
      authorUrl: "https://z.ai",
      homepage: "https://z.ai/plugins/example",
      privacyPolicy: "https://z.ai/privacy",
      termsOfService: "https://z.ai/terms",
      heroImage: "https://cdn-cf.z.ai/hero/example.png",
      examplePrompts: ["Try the example"],
      examplePromptsI18n: { "zh-CN": ["试试这个示例"] },
      requiresPaidPlan: true,
    });

    const bare = manifest?.plugins.find((entry) => entry.name === "bare-plugin");
    expect(bare?.listing).toBeUndefined();

    const ambiguous = manifest?.plugins.find((entry) => entry.name === "ambiguous-plan-plugin");
    expect(ambiguous?.listing).toBeUndefined();
  });

  it("normalizes author from string and object forms", () => {
    expect(normalizeAuthorValue("Acme")).toEqual({ name: "Acme" });
    expect(normalizeAuthorValue({ name: "Z.ai", url: "https://z.ai" })).toEqual({
      name: "Z.ai",
      url: "https://z.ai",
    });
    expect(normalizeAuthorValue("   ")).toBeUndefined();
    expect(normalizeAuthorValue(42)).toBeUndefined();
    expect(parseEntryStoreListing({ name: "x", author: "Acme" })).toEqual({ author: "Acme" });
  });

  it("preserves publisher classification independently of usage category", () => {
    expect(parseEntryStoreListing({ publisherType: "community", category: "productivity" }))
      .toEqual({ publisherType: "community", category: "productivity" });
    expect(parseEntryStoreListing({ publisherType: "official" }))
      .toEqual({ publisherType: "official" });
    expect(parseEntryStoreListing({ publisherType: "personal" })).toBeUndefined();
    expect(parseEntryStoreListing({ publisherType: true })).toBeUndefined();
  });

  it("returns manifest display metadata from describeMarketplacePlugin for installed plugins", async () => {
    const storageRoot = await makeStorageRoot("cf-describe-metadata-");
    const pluginRoot = join(storageRoot, "cache", "hello-market", "hello", "1.2.3");
    await mkdir(join(pluginRoot, ".cf-plugin"), { recursive: true });
    await writeFile(
      join(pluginRoot, ".cf-plugin", "plugin.json"),
      JSON.stringify({
        name: "hello",
        version: "1.2.3",
        description: "hello plugin",
        author: { name: "Acme", url: "https://acme.dev" },
        homepage: "https://acme.dev/hello",
      }),
    );
    await writeFile(
      join(storageRoot, "installed_plugins.json"),
      JSON.stringify({
        version: 1,
        plugins: [
          {
            id: "hello@hello-market",
            name: "hello",
            marketplace: "hello-market",
            version: "1.2.3",
            installPath: pluginRoot,
            installedAt: new Date(0).toISOString(),
            scope: "user",
          },
        ],
      }),
    );

    const result = await describeMarketplacePlugin({
      marketplace: "hello-market",
      name: "hello",
      storageRoot,
    });
    expect(result.metadata).toEqual({
      author: "Acme",
      authorUrl: "https://acme.dev",
      homepage: "https://acme.dev/hello",
      version: "1.2.3",
    });
  });
});
