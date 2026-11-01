import { createHash } from "node:crypto";
import path from "node:path";

import { isException, isSourceFile, moduleForFile, posix } from "./policy.mjs";

function fingerprint(rule, file, detail = "") {
  return createHash("sha256").update(`${rule}\0${file}\0${detail}`).digest("hex").slice(0, 16);
}

export function violation({
  rule,
  file,
  detail,
  message,
  module,
  global = false,
  cwd = process.cwd(),
}) {
  const relative = path.isAbsolute(file) ? posix(path.relative(cwd, file)) : posix(file);
  const relativeDetail =
    typeof detail === "string" && path.isAbsolute(detail) && detail.startsWith(cwd)
      ? posix(path.relative(cwd, detail))
      : detail;
  return {
    rule,
    file: relative,
    module: module?.id ?? null,
    detail: relativeDetail,
    message,
    fingerprint: fingerprint(rule, relative, relativeDetail),
    global,
  };
}

export function cycleViolations(edges, policy, modulesByFile, cwd) {
  const state = new Map();
  const stack = [];
  const cycles = [];
  function visit(node) {
    state.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (!modulesByFile.get(next)?.managed && policy.global.managedOnly) continue;
      if (state.get(next) === 1) {
        const index = stack.indexOf(next);
        cycles.push(stack.slice(index).concat(next));
      } else if (!state.get(next)) visit(next);
    }
    stack.pop();
    state.set(node, 2);
  }
  for (const node of edges.keys()) if (!state.get(node)) visit(node);
  const unique = new Map();
  for (const cycle of cycles) {
    const detail = [...new Set(cycle)]
      .map((item) => posix(path.relative(cwd, item)))
      .sort()
      .join(" -> ");
    const file = cycle[0];
    unique.set(
      detail,
      violation({
        rule: "cycle",
        file,
        detail,
        module: modulesByFile.get(file),
        message: `检测到循环依赖：${cycle.map((item) => posix(path.relative(cwd, item))).join(" -> ")}`,
        global: true,
        cwd,
      }),
    );
  }
  return [...unique.values()];
}

const TEST_LIKE =
  /(\.(test|spec|stories)\.[cm]?[jt]sx?|\.d\.ts)$|(^|\/)(test|tests|__tests__|e2e|__mocks__|fixtures|scripts)\//;

export function unmanagedNewFileViolations(addedFiles, policy, cwd) {
  if (!policy.global.newFilesRequireManagedModule) return [];
  const violations = [];
  for (const relative of addedFiles) {
    const normalized = posix(relative);
    if (!isSourceFile(normalized) || TEST_LIKE.test(normalized)) continue;
    if (!policy.global.newFileScopes.some((scope) => normalized.startsWith(`${scope}/`))) continue;
    if (isException(policy, "unmanaged-new-file", path.resolve(cwd, relative), cwd)) continue;
    const module = moduleForFile(path.resolve(cwd, relative), policy);
    if (module?.managed) continue;
    violations.push(
      violation({
        cwd,
        rule: "unmanaged-new-file",
        file: path.resolve(cwd, relative),
        detail: module?.id ?? "unregistered",
        module,
        message: module
          ? `NewFile落在未受管模块 ${module.id}；请放入 managed 模块，or用 pnpm architecture:adopt <id> --root <dir> 为它所在Table of Contents登记模块`
          : "NewFile不属于任何已登记模块；请用 pnpm architecture:adopt <id> --root <dir> 登记后再Submit",
      }),
    );
  }
  return violations;
}
