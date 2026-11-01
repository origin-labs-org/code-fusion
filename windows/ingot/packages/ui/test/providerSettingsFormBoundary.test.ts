import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Provider Settings 表单边界", () => {
  it("生产 UI 不再把旧 ModelProviderConfig 当作当前设置类型", async () => {
    const sourceRoot = join(import.meta.dirname, "../src");
    const sourceFiles = await collectSourceFiles(sourceRoot);
    const offenders: string[] = [];

    for (const filePath of sourceFiles) {
      const source = await readFile(filePath, "utf8");
      if (/\bModelProvider(?:Model)?Config\b/u.test(source)) {
        offenders.push(filePath.slice(sourceRoot.length + 1));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("Production UI no longer reinterprets legacy Provider startup availability", async () => {
    const sourceRoot = join(import.meta.dirname, "../src");
    const sourceFiles = await collectSourceFiles(sourceRoot);
    const offenders: string[] = [];

    for (const filePath of sourceFiles) {
      const source = await readFile(filePath, "utf8");
      if (
        /\b(?:isModelProviderUsableForAgentStartup|hasUsableModelProviderForAgentStartup)\b/u.test(
          source,
        )
      ) {
        offenders.push(filePath.slice(sourceRoot.length + 1));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("Renderer edit state directly reuses formal Config fields without replicating legacy Store structure", async () => {
    const formTypesPath = join(import.meta.dirname, "../src/lib/providerSettingsFormTypes.ts");
    const source = await readFile(formTypesPath, "utf8");

    expect(source).toContain("ProviderConfigObject");
    expect(source).toContain("ModelConfigObject");
    expect(source).not.toMatch(
      /\b(?:endpoints|defaultKind|kinds|modalities|ProviderOptionsPatch|createdAt|updatedAt)\b/u,
    );
    expect(source).not.toContain('from "@origin-ai/cf-shared"');
  });

  it("API format display no longer retains model-level kind and endpoint edit bypass", async () => {
    const apiFormatDisplayPath = join(
      import.meta.dirname,
      "../src/settings/model-provider-section/ProviderApiFormatSelect.tsx",
    );
    const source = await readFile(apiFormatDisplayPath, "utf8");

    expect(source).not.toMatch(
      /\b(?:ModelProviderKind|getDefaultModelProviderEndpointPathForKind|mapModelProviderApiFormatToKind|ProviderModelApiFormatMultiSelect|endpointPaths)\b/u,
    );
  });

  it("Provider settings use formal ProviderApiType, no longer referencing legacy Store API Format types", async () => {
    const settingsRoot = join(import.meta.dirname, "../src/settings/model-provider-section");
    const sourceFiles = await collectSourceFiles(settingsRoot);
    const offenders: string[] = [];

    for (const filePath of sourceFiles) {
      if (/\bModelProviderApiFormat\b/u.test(await readFile(filePath, "utf8"))) {
        offenders.push(filePath.slice(settingsRoot.length + 1));
      }
    }

    expect(offenders).toEqual([]);
  });
});

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(filePath)));
    } else if (/\.(?:ts|tsx)$/u.test(entry.name)) {
      files.push(filePath);
    }
  }
  return files;
}
