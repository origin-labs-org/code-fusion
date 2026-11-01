import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalHome = process.env.HOME;
const tempHomes: string[] = [];

async function createProviderFixture(prefix: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), prefix));
  tempHomes.push(home);
  process.env.HOME = home;
  const filePath = join(home, "cf-builtin.json");
  await writeFile(
    filePath,
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      config: {
        providerConfigRules: { templateRules: [], providerRules: [] },
        modelConfigRules: {
          modelRules: [],
          modelApiRules: [],
          providerSiteRules: [],
          templateModelRules: [],
          builtinProviderModelRules: [],
        },
      },
    }),
    "utf8",
  );
  return filePath;
}

describe("conversation share service composition", () => {
  beforeEach(() => {
    vi.spyOn(console, "error");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ code: 0, data: { configs: {} } }),
    );
  });

  afterEach(async () => {
    try {
      for (const home of tempHomes.splice(0)) await rm(home, { recursive: true, force: true });
      expect(console.error).not.toHaveBeenCalled();
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      vi.restoreAllMocks();
      vi.resetModules();
    }
  });

  it("registers a real API-backed service for a local desktop host", async () => {
    const cfBuiltinProviderConfigFilePath = await createProviderFixture(
      "cf-conversation-share-",
    );
    const [nodeModule, servicesModule] = await Promise.all([
      import("@origin-ai/cf-services/node"),
      import("@origin-ai/cf-services"),
    ]);

    const services = nodeModule.createLocalServices({ cfBuiltinProviderConfigFilePath });
    try {
      await expect(
        services.get(servicesModule.IModelSelectionService).getView(),
      ).resolves.toMatchObject({
        providers: [],
      });
      const service = services.get(servicesModule.IConversationShareService);
      expect(typeof service.getCapabilities).toBe("function");
    } finally {
      await nodeModule.disposeServiceResourcesAndWait(services);
    }
  });

  it("keeps desktop-attached remote hosts behind the publishing boundary", async () => {
    const cfBuiltinProviderConfigFilePath = await createProviderFixture(
      "cf-conversation-share-remote-",
    );
    const [nodeModule, servicesModule] = await Promise.all([
      import("@origin-ai/cf-services/node"),
      import("@origin-ai/cf-services"),
    ]);

    const services = nodeModule.createLocalServices({
      cfBuiltinProviderConfigFilePath,
      serviceAuthorityMode: "desktop-attached-remote",
    });
    try {
      await expect(
        services.get(servicesModule.IModelSelectionService).getView(),
      ).resolves.toMatchObject({
        providers: [],
      });
      await expect(
        services.get(servicesModule.IConversationShareService).getCapabilities(),
      ).rejects.toMatchObject({ kind: "feature_disabled" });
    } finally {
      await nodeModule.disposeServiceResourcesAndWait(services);
    }
  });
});
