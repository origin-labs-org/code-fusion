import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  intranetConfigured: true,
  downloadNativeSearchTools: vi.fn(),
}));

vi.mock("../../../scripts/intranetDefaults.mjs", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const resolveActual = actual.resolveIntranetDepsBaseUrl as (env?: NodeJS.ProcessEnv) => string;
  return {
    ...actual,
    resolveIntranetDepsBaseUrl: (env?: NodeJS.ProcessEnv) => {
      if (!mocks.intranetConfigured) {
        throw new Error("Configure CF_DEPS_BASE_URL or INTRANET_MACHINE_HOST");
      }
      return resolveActual({ INTRANET_MACHINE_HOST: "intranet-deps.example", ...env });
    },
  };
});

vi.mock("../../../scripts/download-native-search-tools.mjs", () => ({
  downloadNativeSearchTools: mocks.downloadNativeSearchTools,
}));

import {
  NATIVE_SEARCH_DEPENDENCIES_DIR,
  LEGACY_REMOTE_RIPGREP_ARCHIVE_SHA256_BY_TARGET as CONFIG_LEGACY_SHA256,
  LEGACY_REMOTE_RIPGREP_VERSION as CONFIG_LEGACY_VERSION,
  resolveNativeSearchArtifactSource,
  resolveNativeSearchPrebuiltPlan,
} from "../../../scripts/native-search-tools-config.mjs";
import { prepareNativeSearchTools } from "../../../scripts/prepare-native-search-tools.mjs";
import { verifyPrebuiltArchiveSha256 } from "../../../scripts/prebuilt-binary-extract.mjs";
import {
  LEGACY_REMOTE_RIPGREP_ARCHIVE_SHA256_BY_TARGET,
  LEGACY_REMOTE_RIPGREP_VERSION,
  resolveRemoteNativeSearchPrebuiltPlan,
} from "../../../scripts/remote-native-search-tools-config.mjs";

type PrebuiltArtifact = {
  toolId: string;
  release: string;
  archivePath: string;
  archiveSha256: string;
  binaryPath: string;
  downloadUrl?: string;
};
type PrebuiltPlan = { platformKey: string; artifacts: PrebuiltArtifact[] };

const localTargets = [
  ["darwin", "arm64"],
  ["darwin", "x64"],
  ["linux", "arm64"],
  ["linux", "x64"],
  ["win32", "arm64"],
  ["win32", "x64"],
] as const;
const remoteTargets = localTargets.filter(([platform]) => platform !== "win32");

const temporaryDirectories: string[] = [];
async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cf-prepare-native-search-"));
  temporaryDirectories.push(directory);
  return directory;
}

function readSources(artifact: PrebuiltArtifact): {
  binary: { origin: string; toolId: string };
} {
  return JSON.parse(readFileSync(join(dirname(artifact.binaryPath), "SOURCES.json"), "utf8"));
}

beforeEach(() => {
  mocks.intranetConfigured = true;
  mocks.downloadNativeSearchTools.mockReset();
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("native search 归档来源判定", () => {
  it("Determined as intranet when internal dependency source is configured; plan includes both download URL and repository archive of the same name", () => {
    expect(resolveNativeSearchArtifactSource({})).toBe("intranet");
    for (const [platform, arch] of localTargets) {
      const plan = resolveNativeSearchPrebuiltPlan({ platform, arch, env: {} }) as PrebuiltPlan;
      for (const artifact of plan.artifacts) {
        expect(
          artifact.downloadUrl?.endsWith(`/${artifact.archivePath.split(/[\\/]/).pop()}`),
        ).toBe(true);
      }
    }
  });

  it("Explicit NATIVE_SEARCH_TOOLS_DOWNLOAD_BASE_URL still uses intranet when dependency source is unconfigured", () => {
    mocks.intranetConfigured = false;
    expect(
      resolveNativeSearchArtifactSource({
        NATIVE_SEARCH_TOOLS_DOWNLOAD_BASE_URL: "https://deps.example.test/native-search-tools",
      }),
    ).toBe("intranet");
  });

  it("Determined as repository when dependency source is unconfigured; plan no longer resolves download URL", () => {
    mocks.intranetConfigured = false;
    expect(resolveNativeSearchArtifactSource({})).toBe("repository");
    const plan = resolveNativeSearchPrebuiltPlan({
      platform: "linux",
      arch: "x64",
      env: {},
    }) as PrebuiltPlan;
    expect(plan.artifacts.every((artifact) => artifact.downloadUrl === undefined)).toBe(true);
  });

  it("Repository archives referenced by local and remote plans all exist and digests match fixed values", () => {
    const plans = [
      ...localTargets.map(([platform, arch]) =>
        resolveNativeSearchPrebuiltPlan({ platform, arch }),
      ),
      ...remoteTargets.map(([platform, arch]) =>
        resolveRemoteNativeSearchPrebuiltPlan({ platform, arch }),
      ),
    ] as PrebuiltPlan[];
    for (const plan of plans) {
      for (const artifact of plan.artifacts) {
        expect(artifact.archivePath.startsWith(NATIVE_SEARCH_DEPENDENCIES_DIR)).toBe(true);
        expect(() =>
          verifyPrebuiltArchiveSha256(artifact.archivePath, artifact.archiveSha256),
        ).not.toThrow();
      }
    }
    expect(LEGACY_REMOTE_RIPGREP_VERSION).toBe(CONFIG_LEGACY_VERSION);
    expect(LEGACY_REMOTE_RIPGREP_ARCHIVE_SHA256_BY_TARGET).toBe(CONFIG_LEGACY_SHA256);
    const darwinRemote = resolveRemoteNativeSearchPrebuiltPlan({
      platform: "darwin",
      arch: "arm64",
    }) as PrebuiltPlan;
    expect(darwinRemote.artifacts.map(({ toolId, release }) => [toolId, release])).toEqual([
      ["ripgrep", CONFIG_LEGACY_VERSION],
    ]);
  });
});

describe("prepareNativeSearchTools", () => {
  it("intranet source delegates to existing download pipeline as-is and writes intranet-mirror declaration to tool directory", async () => {
    const outputDir = join(await createTemporaryDirectory(), "tools");
    const env = { NATIVE_SEARCH_TOOLS_DOWNLOAD_BASE_URL: "https://deps.example.test/native" };
    mocks.downloadNativeSearchTools.mockImplementation(async (options) => {
      const plan = resolveNativeSearchPrebuiltPlan(options) as PrebuiltPlan;
      for (const artifact of plan.artifacts) {
        mkdirSync(dirname(artifact.binaryPath), { recursive: true });
        writeFileSync(artifact.binaryPath, `${artifact.toolId}-downloaded`);
      }
      return plan;
    });

    const plan = (await prepareNativeSearchTools({
      platform: "linux",
      arch: "x64",
      outputDir,
      env,
    })) as PrebuiltPlan;

    expect(mocks.downloadNativeSearchTools).toHaveBeenCalledTimes(1);
    expect(mocks.downloadNativeSearchTools).toHaveBeenCalledWith({
      platform: "linux",
      arch: "x64",
      outputDir,
      env,
      prebuiltPlan: undefined,
    });
    for (const artifact of plan.artifacts) {
      expect(existsSync(join(dirname(artifact.binaryPath), "THIRD-PARTY-NOTICES.txt"))).toBe(true);
      expect(readSources(artifact).binary).toMatchObject({
        origin: "intranet-mirror",
        toolId: artifact.toolId,
      });
    }
  });

  it("repository source unpacks repository archive without triggering download; skips unpacking on cache hit but refreshes declaration", async () => {
    mocks.intranetConfigured = false;
    const outputDir = join(await createTemporaryDirectory(), "tools");

    const plan = (await prepareNativeSearchTools({
      platform: "linux",
      arch: "x64",
      outputDir,
      env: {},
    })) as PrebuiltPlan;

    expect(mocks.downloadNativeSearchTools).not.toHaveBeenCalled();
    expect(plan.artifacts.map(({ toolId }) => toolId)).toEqual(["bfs", "ugrep", "ripgrep"]);
    for (const artifact of plan.artifacts) {
      expect(existsSync(artifact.binaryPath)).toBe(true);
      expect(readSources(artifact).binary.origin).toBe("repository-archive");
      rmSync(join(dirname(artifact.binaryPath), "THIRD-PARTY-NOTICES.txt"));
    }

    const binaryBeforeCacheHit = readFileSync(plan.artifacts[0].binaryPath);
    await prepareNativeSearchTools({ platform: "linux", arch: "x64", outputDir, env: {} });
    expect(readFileSync(plan.artifacts[0].binaryPath)).toEqual(binaryBeforeCacheHit);
    for (const artifact of plan.artifacts) {
      expect(existsSync(join(dirname(artifact.binaryPath), "THIRD-PARTY-NOTICES.txt"))).toBe(true);
    }
  });

  it("Fails before replacing any artifacts when repository archive is modified", async () => {
    const root = await createTemporaryDirectory();
    const dependenciesDir = join(root, "dependencies");
    cpSync(NATIVE_SEARCH_DEPENDENCIES_DIR, dependenciesDir, { recursive: true });
    const plan = resolveNativeSearchPrebuiltPlan({
      platform: "linux",
      arch: "x64",
      outputDir: join(root, "tools"),
      dependenciesDir,
    }) as PrebuiltPlan;
    writeFileSync(plan.artifacts[1].archivePath, "tampered");

    await expect(
      prepareNativeSearchTools({ prebuiltPlan: plan, source: "repository" }),
    ).rejects.toThrow(/Invalid local native search archive/u);
    expect(plan.artifacts.some((artifact) => existsSync(artifact.binaryPath))).toBe(false);
  });
});
