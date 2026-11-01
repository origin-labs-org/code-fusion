import { existsSync, readFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { createRequire } from "node:module";

function findPackageRoot(entryPath) {
  let currentDir = dirname(entryPath);
  const root = parse(currentDir).root;
  while (currentDir !== root) {
    const packageJsonPath = resolve(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }
  return null;
}

function readRuntimePackage(moduleLookupRoots, moduleName, parentPackagePath = null) {
  if (parentPackagePath) {
    try {
      const requireFromParent = createRequire(parentPackagePath);
      const entryPath = requireFromParent.resolve(moduleName);
      const packageRoot = findPackageRoot(entryPath);
      if (packageRoot) {
        const packageJsonPath = resolve(packageRoot, "package.json");
        return {
          packageJson: JSON.parse(readFileSync(packageJsonPath, "utf8")),
          packageJsonPath,
          packageRoot,
        };
      }
    } catch {
    }
  }

  for (const lookupRoot of moduleLookupRoots) {
    const packageJsonPath = resolve(lookupRoot, "node_modules", moduleName, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    return {
      packageJson: JSON.parse(readFileSync(packageJsonPath, "utf8")),
      packageJsonPath,
      packageRoot: dirname(packageJsonPath),
    };
  }
  return null;
}

export function collectRuntimeModuleClosure(moduleNames, moduleLookupRoots) {
  return collectRuntimeModuleClosureEntries(moduleNames, moduleLookupRoots).map(
    (entry) => entry.moduleName,
  );
}

export function collectRuntimeModuleClosureEntries(moduleNames, moduleLookupRoots) {
  const collected = [];
  const visited = new Set();

  function visit(moduleName, optional = false, parentPackagePath = null) {
    if (visited.has(moduleName)) {
      return;
    }

    const runtimePackage = readRuntimePackage(moduleLookupRoots, moduleName, parentPackagePath);
    if (!runtimePackage && optional) {
      return;
    }

    visited.add(moduleName);
    collected.push({
      moduleName,
      sourceModulePath: runtimePackage?.packageRoot ?? null,
      packageJsonPath: runtimePackage?.packageJsonPath ?? null,
    });

    if (!runtimePackage) {
      return;
    }

    const { packageJson, packageJsonPath } = runtimePackage;
    const dependencies = packageJson.dependencies ?? {};
    const optionalDependencies = packageJson.optionalDependencies ?? {};
    const dependencyEntries = [
      ...Object.keys(dependencies).map((dependencyName) => [dependencyName, false]),
      ...Object.keys(optionalDependencies).map((dependencyName) => [dependencyName, true]),
    ];

    for (const [dependencyName, isOptional] of dependencyEntries.sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      visit(dependencyName, isOptional, packageJsonPath);
    }
  }

  for (const moduleName of moduleNames) {
    visit(moduleName);
  }

  return collected;
}
