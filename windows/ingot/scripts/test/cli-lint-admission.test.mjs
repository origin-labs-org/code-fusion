import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyLintDiagnostics, parseLintCommand } from "../cli-lint-admission.mjs";

test("只接纳原样上游的行CountDiagnostics，OtherError与修改过的File仍阻断", () => {
  const diagnostics = [
    { filename: "src/original.ts", code: "eslint(max-lines)", severity: "error" },
    { filename: "src/edited.ts", code: "eslint(max-lines)", severity: "error" },
    { filename: "src/original.ts", code: "typescript(no-explicit-any)", severity: "error" },
    { filename: "src/original.ts", code: "eslint(no-unused-vars)", severity: "warning" },
  ];
  const result = classifyLintDiagnostics(diagnostics, {
    relativeDirectory: "apps/cli/packages/example",
    pristine: new Set(["apps/cli/packages/example/src/original.ts"]),
  });
  assert.deepEqual(result.accepted, [diagnostics[0]]);
  assert.deepEqual(result.errors, diagnostics.slice(1, 3));
  assert.deepEqual(result.warnings, [diagnostics[3]]);
});

test("Retain包原有参Count；不默默绕过Unknownor复合Command", () => {
  assert.deepEqual(parseLintCommand("oxlint src tests --no-ignore"), [
    "src",
    "tests",
    "--no-ignore",
  ]);
  for (const command of [
    "tsc --noEmit",
    "oxlint src && echo done",
    "oxlint 'src path'",
    "oxlint --format text src",
  ])
    assert.throws(() => parseLintCommand(command), /不支持/);
});
