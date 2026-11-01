import { access, chmod, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRuntimeManifest, type ServerTarget } from "../runtime/manifest.js";
import {
  collectBareModuleSpecifiers,
  copyPackageDir,
  ensureNodePtyPrebuild,
  isNodePtyRuntimePath,
  isTargetSpecificPackage,
  pruneKoffiRuntime,
  resolveProductionPackageClosure,
} from "./stageDependencies.js";
import { createComponentArchive, hashPaths, runPackagingCommand } from "./stageArchives.js";

export { collectBareModuleSpecifiers, isNodePtyRuntimePath, resolveProductionPackageClosure };

export interface StageOptions {
  target: ServerTarget;
  appVersion: string;
  
  distDir: string;
  
  agentBundlePath: string;
  
  bundledSkillsDir: string;
  
  nodeBinaryPath: string;
  
  notices: { thirdParty: string; node: string; nodeSource: string };
  
  workspaceNodeModulesDir: string;
  
  workspacePackageDirs?: ReadonlyMap<string, string>;
  
  outputDir: string;
  
  nativeToolsDir?: string;
  
  officialPluginsDir?: string;
  
  archive?: boolean;
  
  componentArchives?: boolean;
}

export interface StagedRelease {
  releaseDir: string;
  archivePath: string | null;
  componentArchivePaths: string[];
  packagedDependencies: string[];
}

const POSIX_LAUNCHER = `#!/bin/sh
DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$DIR/runtime/node" "$DIR/runtime/server-cli.js" "$@"
`;

const WINDOWS_LAUNCHER = [
  "@echo off",
  'set "DIR=%~dp0.."',
  '"%DIR%\\runtime\\node.exe" "%DIR%\\runtime\\server-cli.js" %*',
  "",
].join("\r\n");

async function copyDirectoryIfPresent(
  sourceDir: string | undefined,
  targetDir: string,
): Promise<string[]> {
  if (!sourceDir) return [];
  try {
    await access(sourceDir);
  } catch {
    return [];
  }
  const candidates = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-plugin"))
    .map((entry) => entry.name)
    .filter((name) => name !== "superpowers-plugin")
    .sort();
  const names: string[] = [];
  for (const name of candidates) {
    try {
      await access(join(sourceDir, name, "package.json"));
      names.push(name);
    } catch {
    }
  }
  for (const name of names) {
    const stagedDir = join(targetDir, name);
    await copyPackageDir(join(sourceDir, name), stagedDir);
    await assertOfficialPluginRuntime(stagedDir, name);
  }
  return names.map((name) => name.replace(/-plugin$/u, ""));
}

const PLUGIN_ROOT_PLACEHOLDER_PREFIX = "${CF_PLUGIN_ROOT}/";

async function assertOfficialPluginRuntime(stagedDir: string, name: string): Promise<void> {
  const manifestPath = join(stagedDir, ".cf-plugin", "plugin.json");
  let manifest: {
    mcpServers?: Record<string, { command?: unknown; args?: unknown } | undefined>;
  };
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as typeof manifest;
  } catch (error) {
    throw new Error(`Official plugin ${name} has no readable manifest: ${manifestPath}`, {
      cause: error,
    });
  }
  const missing: string[] = [];
  for (const server of Object.values(manifest.mcpServers ?? {})) {
    if (!server) continue;
    const references = [server.command, ...(Array.isArray(server.args) ? server.args : [])];
    for (const reference of references) {
      if (typeof reference !== "string" || !reference.startsWith(PLUGIN_ROOT_PLACEHOLDER_PREFIX))
        continue;
      const relativePath = reference.slice(PLUGIN_ROOT_PLACEHOLDER_PREFIX.length);
      try {
        await access(join(stagedDir, ...relativePath.split("/")));
      } catch {
        missing.push(relativePath);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Official plugin ${name} manifest references MCP runtime files missing from the staged package: ${missing.join(", ")} (build the plugin before staging)`,
    );
  }
}

const BUNDLED_SKILL_PACK_TOP_LEVEL_PATHS: readonly string[] = ["README.md", "skills"];

async function copyNativeTools(
  sourceDir: string | undefined,
  targetDir: string,
  target: ServerTarget,
): Promise<string[]> {
  if (!sourceDir) return [];
  try {
    await access(sourceDir);
  } catch {
    return [];
  }
  const ids = target.startsWith("win32-") ? ["ripgrep", "ugrep"] : ["bfs", "ripgrep", "ugrep"];
  const copied: string[] = [];
  for (const id of ids) {
    const source = join(
      sourceDir,
      id,
      id === "ripgrep"
        ? target.startsWith("win32-")
          ? "rg.exe"
          : "rg"
        : id + (target.startsWith("win32-") ? ".exe" : ""),
    );
    try {
      await access(source);
    } catch {
      continue;
    }
    const targetPath = join(targetDir, id, source.split(sep).pop() ?? id);
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(source, targetPath, { dereference: true });
    for (const notice of ["THIRD-PARTY-NOTICES.txt", "SOURCES.json"]) {
      const bytes = await readFile(join(dirname(source), notice));
      if (!bytes.length) throw new Error(`Empty native notice: ${notice}`);
      await writeFile(join(dirname(targetPath), notice), bytes);
    }
    if (!target.startsWith("win32-")) await chmod(targetPath, 0o755);
    copied.push(id);
  }
  return copied;
}

export async function stageRelease(options: StageOptions): Promise<StagedRelease> {
  for (const [name, value] of Object.entries(options.notices)) {
    if (!value.trim()) throw new Error(`Missing distribution notice: ${name}`);
  }
  const releaseName = `cf-server-${options.target}`;
  const outputRoot = resolve(options.outputDir);
  const releaseDir = join(outputRoot, releaseName);
  const runtimeDir = join(releaseDir, "runtime");
  await rm(releaseDir, { force: true, recursive: true });
  await rm(join(outputRoot, "components", options.target), {
    force: true,
    recursive: true,
  });
  await rm(join(outputRoot, ".components"), { force: true, recursive: true });
  await mkdir(join(releaseDir, "bin"), { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(join(runtimeDir, "THIRD-PARTY-NOTICES.md"), options.notices.thirdParty);
  await writeFile(join(runtimeDir, "LICENSE.node.txt"), options.notices.node);
  await writeFile(join(runtimeDir, "NODE-SOURCES.json"), options.notices.nodeSource);
  for (const component of ["agent", "official-plugins"]) {
    await mkdir(join(runtimeDir, "licenses", component), { recursive: true });
    await writeFile(
      join(runtimeDir, "licenses", component, "THIRD-PARTY-NOTICES.md"),
      options.notices.thirdParty,
    );
  }

  const bundleSources: string[] = [];
  for (const entryName of ["server-cli.js", "server-core.js"]) {
    const sourcePath = join(options.distDir, entryName);
    const contents = await readFile(sourcePath, "utf8");
    bundleSources.push(contents);
    await writeFile(join(runtimeDir, entryName), contents, "utf8");
  }
  await writeFile(
    join(runtimeDir, "package.json"),
    `${JSON.stringify({ name: releaseName, private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );
  await cp(options.agentBundlePath, join(runtimeDir, "cf.cjs"), {
    dereference: true,
  });
  for (const file of ["SKILL.md", "patterns.md", "examples.md"]) {
    const skillPath = join(options.bundledSkillsDir, "skills/dynamic-workflows", file);
    try {
      await access(skillPath);
    } catch (cause) {
      throw new Error(`Missing bundled skill required asset: ${skillPath}`, { cause });
    }
  }
  await copyPackageDir(
    options.bundledSkillsDir,
    join(runtimeDir, "packages/bundled-skills"),
    (relativePath) => BUNDLED_SKILL_PACK_TOP_LEVEL_PATHS.includes(relativePath.split(sep)[0] ?? ""),
  );
  bundleSources.push(await readFile(options.agentBundlePath, "utf8"));

  const nodeTargetPath = join(
    runtimeDir,
    options.target.startsWith("win32-") ? "node.exe" : "node",
  );
  await cp(options.nodeBinaryPath, nodeTargetPath, { dereference: true });
  if (!options.target.startsWith("win32-")) await chmod(nodeTargetPath, 0o755);

  const referencedPackages = new Set<string>();
  for (const source of bundleSources) {
    for (const name of collectBareModuleSpecifiers(source)) referencedPackages.add(name);
  }
  const rawClosure = await resolveProductionPackageClosure(
    [...referencedPackages],
    options.workspaceNodeModulesDir,
    options.workspacePackageDirs,
  );
  const closure = new Map(
    [...rawClosure].filter(([packageName]) => isTargetSpecificPackage(packageName, options.target)),
  );
  const nodeModulesTargetDir = join(runtimeDir, "node_modules");
  for (const [packageName, packageDir] of closure) {
    const targetDir = join(nodeModulesTargetDir, ...packageName.split("/"));
    await mkdir(dirname(targetDir), { recursive: true });
    if (packageName === "node-pty") {
      await copyPackageDir(packageDir, targetDir, (relativePath) =>
        isNodePtyRuntimePath(relativePath, options.target),
      );
    } else {
      await copyPackageDir(
        packageDir,
        targetDir,
        undefined,
        packageName === "ajv-formats" || packageName === "ajv-keywords",
      );
      if (packageName === "koffi") await pruneKoffiRuntime(packageDir, targetDir, options.target);
    }
  }

  if (closure.has("node-pty")) {
    await ensureNodePtyPrebuild(options, nodeModulesTargetDir);
  }

  const tools = await copyNativeTools(
    options.nativeToolsDir,
    join(runtimeDir, "tools"),
    options.target,
  );
  const plugins = await copyDirectoryIfPresent(
    options.officialPluginsDir,
    join(runtimeDir, "packages"),
  );

  const launcherPath = join(
    releaseDir,
    "bin",
    options.target.startsWith("win32-") ? "cf.cmd" : "cf",
  );
  await writeFile(launcherPath, POSIX_LAUNCHER, "utf8");
  if (options.target.startsWith("win32-")) {
    await writeFile(launcherPath, WINDOWS_LAUNCHER, "utf8");
  } else {
    await chmod(launcherPath, 0o755);
  }

  const componentSpecs = [
    {
      id: "node-runtime",
      paths: [
        options.target.startsWith("win32-") ? "runtime/node.exe" : "runtime/node",
        "runtime/LICENSE.node.txt",
        "runtime/NODE-SOURCES.json",
      ],
    },
    {
      id: "server-runtime",
      paths: [
        "runtime/server-cli.js",
        "runtime/server-core.js",
        "runtime/package.json",
        "runtime/node_modules",
        "runtime/THIRD-PARTY-NOTICES.md",
      ],
    },
    {
      id: "agent-runtime",
      paths: ["runtime/cf.cjs", "runtime/packages/bundled-skills", "runtime/licenses/agent"],
    },
    ...(plugins.length > 0
      ? [
          {
            id: "official-plugins",
            paths: [
              ...plugins.map((name) => `runtime/packages/${name}-plugin`),
              "runtime/licenses/official-plugins",
            ],
          },
        ]
      : []),
    ...(tools.length > 0 ? [{ id: "native-search-tools", paths: ["runtime/tools"] }] : []),
  ];
  const componentMeta: Array<{
    id: string;
    sha256: string;
    paths: string[];
    sizeBytes: number;
    archivePath?: string;
  }> = [];
  const componentArchivePaths: string[] = [];
  for (const component of componentSpecs) {
    const info = await hashPaths(releaseDir, component.paths);
    componentMeta.push({ ...component, ...info });
  }
  const manifest = createRuntimeManifest(options.target, options.appVersion, {
    tools,
    plugins,
    components: componentMeta,
  });
  if (options.componentArchives !== false) {
    for (const component of componentMeta) {
      const archive = await createComponentArchive(
        releaseDir,
        outputRoot,
        options.target,
        component.id,
        component.paths,
      );
      component.archivePath = relative(outputRoot, archive.archivePath).split(sep).join("/");
      componentArchivePaths.push(archive.archivePath);
    }
  }
  await writeFile(
    join(releaseDir, "manifest.json"),
    `${JSON.stringify({ ...manifest, components: componentMeta }, null, 2)}\n`,
    "utf8",
  );

  let archivePath: string | null = null;
  if (options.archive !== false) {
    const extension = options.target.startsWith("win32-") ? "zip" : "tar.gz";
    archivePath = join(outputRoot, `${releaseName}.${extension}`);
    await rm(archivePath, { force: true });
    if (extension === "zip")
      await runPackagingCommand("zip", ["-qr", archivePath, releaseName], outputRoot);
    else await runPackagingCommand("tar", ["-czf", archivePath, releaseName], outputRoot);
  }

  return {
    releaseDir,
    archivePath,
    componentArchivePaths,
    packagedDependencies: [...closure.keys()].sort(),
  };
}
