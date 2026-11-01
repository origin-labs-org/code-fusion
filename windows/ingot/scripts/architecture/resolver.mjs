
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseConfigFileTextToJson } from "typescript";

export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

const DEFAULT_WORKSPACE_GLOBS = ["packages/*", "apps/*", "apps/*/packages*.ts 串成块注释，漏掉 UI Aliases甚至整个 Desktop 包。
    const result = parseConfigFileTextToJson(file, text);
    return result.error ? null : result.config;
  } catch {
    return null;
  }
}

async function expandGlob(cwd, pattern) {
  const segments = pattern.split("/").filter(Boolean);
  let current = [cwd];
  for (const segment of segments) {
    const next = [];
    for (const dir of current) {
      if (segment === "*") {
        let entries = [];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== "node_modules")
            next.push(path.join(dir, entry.name));
        }
      } else {
        next.push(path.join(dir, segment));
      }
    }
    current = next;
  }
  return current;
}

async function workspaceGlobs(cwd) {
  try {
    const raw = parseYaml(await fs.readFile(path.join(cwd, "pnpm-workspace.yaml"), "utf8"));
    if (Array.isArray(raw?.packages) && raw.packages.length > 0) return raw.packages;
  } catch {
  }
  return DEFAULT_WORKSPACE_GLOBS;
}

export async function loadWorkspace(cwd = process.cwd()) {
  const dirs = new Set();
  for (const glob of await workspaceGlobs(cwd)) {
    for (const dir of await expandGlob(cwd, glob)) dirs.add(dir);
  }
  const packages = [];
  for (const dir of dirs) {
    const manifest = await readJsonLoose(path.join(dir, "package.json"));
    if (!manifest) continue;
    const tsconfig = await readJsonLoose(path.join(dir, "tsconfig.json"));
    const paths = tsconfig?.compilerOptions?.paths ?? null;
    const baseUrl = tsconfig?.compilerOptions?.baseUrl ?? ".";
    packages.push({
      name: typeof manifest.name === "string" ? manifest.name : null,
      dir,
      exports: manifest.exports ?? null,
      imports: manifest.imports ?? null,
      main: typeof manifest.main === "string" ? manifest.main : null,
      paths,
      pathsBase: path.resolve(dir, baseUrl),
    });
  }
  packages.sort((a, b) => b.dir.length - a.dir.length);
  const byName = new Map();
  for (const pkg of packages) if (pkg.name) byName.set(pkg.name, pkg);
  return { cwd, packages, byName };
}

function nearestPackage(file, workspace) {
  return workspace.packages.find((pkg) => file.startsWith(`${pkg.dir}${path.sep}`)) ?? null;
}

function matchMap(map, key) {
  if (!map || typeof map !== "object") return null;
  if (Object.hasOwn(map, key)) return { value: map[key], wildcard: null };
  for (const [pattern, value] of Object.entries(map)) {
    const star = pattern.indexOf("*");
    if (star < 0) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (key.startsWith(prefix) && key.endsWith(suffix) && key.length >= pattern.length - 1) {
      return { value, wildcard: key.slice(prefix.length, key.length - suffix.length) };
    }
  }
  return null;
}

function targetsOf(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(targetsOf);
  if (value && typeof value === "object") {
    const ordered = EXPORT_CONDITION_ORDER.filter((key) => key in value).map((key) => value[key]);
    const rest = Object.entries(value)
      .filter(([key]) => !EXPORT_CONDITION_ORDER.includes(key))
      .map(([, item]) => item);
    return [...ordered, ...rest].flatMap(targetsOf);
  }
  return [];
}

function substitute(target, wildcard) {
  return wildcard === null ? target : target.replace("*", wildcard);
}

function stripExtension(base) {
  if (base.endsWith(".d.ts")) return base.slice(0, -".d.ts".length);
  const extension = SOURCE_EXTENSIONS.find((item) => base.endsWith(item));
  return extension ? base.slice(0, -extension.length) : base;
}

function probe(absolute, knownFiles) {
  const base = stripExtension(absolute);
  const candidates = [];
  for (const extension of SOURCE_EXTENSIONS) candidates.push(`${base}${extension}`);
  for (const extension of SOURCE_EXTENSIONS) candidates.push(path.join(base, `index${extension}`));
  const found = candidates.find((candidate) => knownFiles.has(candidate));
  if (found) return found;
  const distIndex = base.split(path.sep).lastIndexOf("dist");
  if (distIndex >= 0) {
    const parts = base.split(path.sep);
    parts[distIndex] = "src";
    return probe(parts.join(path.sep), knownFiles);
  }
  return null;
}

export function resolveSpecifier(from, specifier, knownFiles, workspace = null) {
  if (specifier.startsWith(".")) {
    return probe(path.resolve(path.dirname(from), specifier), knownFiles);
  }
  if (!workspace) return null;
  const pkg = nearestPackage(from, workspace);

  if (specifier.startsWith("#") && pkg?.imports) {
    const hit = matchMap(pkg.imports, specifier);
    if (hit) {
      for (const target of targetsOf(hit.value)) {
        const found = probe(path.resolve(pkg.dir, substitute(target, hit.wildcard)), knownFiles);
        if (found) return found;
      }
    }
  }

  if (pkg?.paths) {
    const hit = matchMap(pkg.paths, specifier);
    if (hit) {
      for (const target of targetsOf(hit.value)) {
        const found = probe(
          path.resolve(pkg.pathsBase, substitute(target, hit.wildcard)),
          knownFiles,
        );
        if (found) return found;
      }
    }
  }

  let owner = null;
  for (const [name, candidate] of workspace.byName) {
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      if (!owner || name.length > owner.name.length) owner = candidate;
    }
  }
  if (!owner) return null;
  const subpath = specifier === owner.name ? "." : `./${specifier.slice(owner.name.length + 1)}`;
  const candidates = [];
  const hit = matchMap(owner.exports, subpath);
  if (hit)
    candidates.push(...targetsOf(hit.value).map((target) => substitute(target, hit.wildcard)));
  if (subpath === ".") {
    if (owner.main) candidates.push(owner.main);
    candidates.push("./src/index", "./index");
  } else {
    candidates.push(subpath, `./src/${subpath.slice(2)}`);
  }
  for (const candidate of candidates) {
    const found = probe(path.resolve(owner.dir, candidate), knownFiles);
    if (found) return found;
  }
  return null;
}
