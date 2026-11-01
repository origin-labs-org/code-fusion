
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

import {
  discoverFiles,
  importsOf,
  loadPolicy,
  moduleForFile,
  posix,
  resolveImport,
} from "./policy.mjs";
import { loadWorkspace } from "./resolver.mjs";

const ARTIFACTS = [
  "module.ts",
  "contract.ts",
  "contract.example.ts",
  "contract.test.ts",
  "CONTRACT.md",
];

function camel(id) {
  return id.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
}

function templates({ id, requires, layer }) {
  const name = camel(id);
  return {
    "module.ts": `
export const ${name}Module = {
  id: "${id}",
  requires: [${requires.map((item) => `"${item}"`).join(", ")}],
  provides: ["${id}"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
`,
    "contract.ts": `
export type ${name[0].toUpperCase() + name.slice(1)}Id = string & { readonly __brand: "${name[0].toUpperCase() + name.slice(1)}Id" };

export interface ${name[0].toUpperCase() + name.slice(1)}Contract {
}
`,
    "contract.example.ts": `
import type { ${name[0].toUpperCase() + name.slice(1)}Contract } from "./contract.js";

export function example${name[0].toUpperCase() + name.slice(1)}(_contract: ${name[0].toUpperCase() + name.slice(1)}Contract): void {
}
`,
    "contract.test.ts": `import { describe, expect, it } from "vitest";

import { ${name}Module } from "./module.js";

describe("${id} contract", () => {
  it("declares its module manifest", () => {
    expect(${name}Module.id).toBe("${id}");
  });
});
`,
    "CONTRACT.md": `# ${id}

One页以inner。只写类型与Tests表达不了的Three样：模块存在的意图、Invariants、与Other模块的交集在哪个 hook 点Processing。

Invariants：

- TODO
`,
  };
}

export async function adoptModule({
  cwd = process.cwd(),
  id,
  roots,
  layer = "adapters",
  owner = null,
  requires = [],
  publicEntrypoints = null,
}) {
  if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`模块 id 非法: ${id}`);
  if (!Array.isArray(roots) || roots.length === 0) throw new Error("必须提供至少One个 --root");
  const absoluteRoots = roots.map((root) => path.resolve(cwd, root));
  for (const root of absoluteRoots) {
    const stat = await fs.stat(root).catch(() => null);
    if (!stat?.isDirectory()) throw new Error(`root 不YesTable of Contents: ${root}`);
  }

  const policyPath = path.join(cwd, "architecture-policy.yaml");
  const doc = parseDocument(await fs.readFile(policyPath, "utf8"));
  const modules = doc.get("modules");
  if (!modules || typeof modules.items === "undefined")
    throw new Error("architecture-policy.yaml Missing modules 序列");
  const existing = modules.items.find((item) => item.get?.("id") === id);
  const primaryRoot = posix(path.relative(cwd, absoluteRoots[0]));
  const entrypoints = publicEntrypoints ?? [
    `${primaryRoot}/index.ts`,
    `${primaryRoot}/contract.ts`,
  ];

  const currentPolicy = await loadPolicy(cwd);
  const virtualModule = {
    id,
    roots: absoluteRoots,
    managed: true,
    requires: [],
    publicEntrypoints: entrypoints,
    layers: { [layer]: "." },
    layerOrder: [layer],
    owner,
  };
  const virtualPolicy = {
    ...currentPolicy,
    modules: [...currentPolicy.modules.filter((module) => module.id !== id), virtualModule],
  };
  const workspace = await loadWorkspace(cwd);
  const files = await discoverFiles(virtualPolicy);
  const knownFiles = new Set(files);
  const inferred = new Set(requires);
  for (const file of files) {
    if (moduleForFile(file, virtualPolicy)?.id !== id) continue;
    const source = await fs.readFile(file, "utf8");
    for (const specifier of importsOf(file, source)) {
      const target = resolveImport(file, specifier, knownFiles, workspace);
      const targetModule = target && moduleForFile(target, virtualPolicy);
      if (targetModule && targetModule.id !== id) inferred.add(targetModule.id);
    }
  }
  const finalRequires = [...inferred].sort();

  const created = [];
  const rendered = templates({ id, requires: finalRequires, layer });
  for (const artifact of ARTIFACTS) {
    const target = path.join(absoluteRoots[0], artifact);
    const exists = await fs.stat(target).catch(() => null);
    if (exists) continue;
    await fs.writeFile(target, rendered[artifact]);
    created.push(posix(path.relative(cwd, target)));
  }

  let registered = false;
  if (existing) {
    existing.set("managed", true);
    if (!existing.has("requires")) existing.set("requires", finalRequires);
    if (!existing.has("publicEntrypoints")) existing.set("publicEntrypoints", entrypoints);
    if (!existing.has("layers")) existing.set("layers", { [layer]: "." });
    if (owner && !existing.has("owner")) existing.set("owner", owner);
  } else {
    const node = doc.createNode({
      id,
      roots: absoluteRoots.map((root) => posix(path.relative(cwd, root))),
      managed: true,
      requires: finalRequires,
      publicEntrypoints: entrypoints,
      layers: { [layer]: "." },
      ...(owner ? { owner } : {}),
    });
    node.commentBefore = ` ${id}：由 architecture:adopt 登记`;
    modules.add(node);
    registered = true;
  }
  await fs.writeFile(policyPath, doc.toString({ lineWidth: 0 }));
  await loadPolicy(cwd);
  return {
    id,
    roots: absoluteRoots.map((root) => posix(path.relative(cwd, root))),
    requires: finalRequires,
    created,
    registered,
  };
}
