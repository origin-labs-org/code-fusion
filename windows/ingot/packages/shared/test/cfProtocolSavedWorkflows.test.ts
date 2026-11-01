// docs/dynamic-workflow/launch.md「Data path」）。
import { describe, expect, it } from "vitest";
import {
  CF_WORKFLOWS_RUNS_MAX_LIMIT,
  cfProtocolMethods,
  cfSavedWorkflowMetaSchema,
  cfWorkflowsDeleteParamsSchema,
  cfWorkflowsDeleteResultSchema,
  cfWorkflowsGetParamsSchema,
  cfWorkflowsGetResultSchema,
  cfWorkflowsListParamsSchema,
  cfWorkflowsListResultSchema,
  cfWorkflowsMoveParamsSchema,
  cfWorkflowsMoveResultSchema,
  cfWorkflowsRunsParamsSchema,
  cfWorkflowsRunsResultSchema,
  cfWorkflowsUpdateMetaParamsSchema,
  cfWorkflowsUpdateMetaResultSchema,
  CF_WORKFLOWS_FOR_RUN_MAX_CANDIDATES,
  cfWorkflowsForRunParamsSchema,
  cfWorkflowsForRunResultSchema,
  cfWorkflowsSaveParamsSchema,
  cfWorkflowsSaveResultSchema,
} from "../src/cf-protocol/index.js";

const workspace = { workspacePath: "/repo", workspaceKey: "/repo" };

describe("cf-protocol saved workflows", () => {
  it("方法名固定，都是 workspace 级、无 session 的方法", () => {
    expect(cfProtocolMethods.workflowsList).toBe("workflows/list");
    expect(cfProtocolMethods.workflowsGet).toBe("workflows/get");
    expect(cfProtocolMethods.workflowsUpdateMeta).toBe("workflows/updateMeta");
    expect(cfProtocolMethods.workflowsDelete).toBe("workflows/delete");
    expect(cfProtocolMethods.workflowsRuns).toBe("workflows/runs");
    expect(cfProtocolMethods.workflowsMove).toBe("workflows/move");
  });

  it("list：结果里的条目不含脚本正文，坏文件单列 invalid，dir 必填", () => {
    expect(cfWorkflowsListParamsSchema.parse({ workspace })).toEqual({ workspace });
    expect(cfWorkflowsListParamsSchema.parse({ workspace, scope: "global" }).scope).toBe(
      "global",
    );
    expect(() => cfWorkflowsListParamsSchema.parse({ workspace, scope: "user" })).toThrow();
    const result = cfWorkflowsListResultSchema.parse({
      workflows: [
        {
          name: "x",
          description: "d",
          scope: "global",
          path: "/home/me/.cf/workflows/x.dwf.ts",
          args: { branch: { type: "string", required: true } },
        },
      ],
      invalid: [{ path: "/repo/.cf/workflows/bad.dwf.ts", reason: "invalid_yaml" }],
      dir: "/home/me/.cf/workflows",
    });
    expect(result.workflows[0]?.args?.branch?.required).toBe(true);
    expect(result.dir).toBe("/home/me/.cf/workflows");
    expect(() =>
      cfWorkflowsListResultSchema.parse({
        workflows: [],
        invalid: [],
      }),
    ).toThrow();
    expect(() =>
      cfWorkflowsListResultSchema.parse({
        workflows: [{ name: "x", description: "d", scope: "project", path: "/p", script: "…" }],
        invalid: [],
        dir: "/repo/.cf/workflows",
      }),
    ).toThrow();
  });

  it("get：scope 可选；ok 分支带 meta + script；失败分支 reason 四态可分辨", () => {
    expect(cfWorkflowsGetParamsSchema.parse({ workspace, name: "x" })).toEqual({
      workspace,
      name: "x",
    });
    expect(
      cfWorkflowsGetParamsSchema.parse({ workspace, name: "x", scope: "global" }).scope,
    ).toBe("global");
    expect(() =>
      cfWorkflowsGetParamsSchema.parse({ workspace, name: "x", scope: "user" }),
    ).toThrow();
    const ok = cfWorkflowsGetResultSchema.parse({
      ok: true,
      name: "x",
      path: "/p",
      scope: "global",
      meta: { description: "d", whenToUse: "w" },
      script: "export default async () => {}",
    });
    expect(ok.ok).toBe(true);
    for (const reason of ["invalid_name", "not_found", "parse_error", "read_error"]) {
      expect(cfWorkflowsGetResultSchema.parse({ ok: false, reason })).toEqual({
        ok: false,
        reason,
      });
    }
    expect(() => cfWorkflowsGetResultSchema.parse({ ok: false, reason: "boom" })).toThrow();
  });

  it("updateMeta: scope is optional; meta reuses contracts\' meta schema, strict rejects unknown keys", () => {
    const meta = { description: "d", args: { n: { type: "number", default: 3 } } };
    expect(cfWorkflowsUpdateMetaParamsSchema.parse({ workspace, name: "x", meta })).toEqual({
      workspace,
      name: "x",
      meta,
    });
    expect(
      cfWorkflowsUpdateMetaParamsSchema.parse({ workspace, name: "x", meta, scope: "global" })
        .scope,
    ).toBe("global");
    expect(() => cfSavedWorkflowMetaSchema.parse({ description: "" })).toThrow();
    expect(() => cfSavedWorkflowMetaSchema.parse({ description: "d", script: "x" })).toThrow();
    expect(() =>
      cfWorkflowsUpdateMetaParamsSchema.parse({ workspace, name: "x", meta, script: "x" }),
    ).toThrow();
    expect(cfWorkflowsUpdateMetaResultSchema.parse({ ok: true, path: "/p" })).toEqual({
      ok: true,
      path: "/p",
    });
  });

  it("delete：scope 可选；params 只有 workspace + name (+ scope)；结果 ok/failure 二态", () => {
    expect(cfWorkflowsDeleteParamsSchema.parse({ workspace, name: "x" })).toEqual({
      workspace,
      name: "x",
    });
    expect(
      cfWorkflowsDeleteParamsSchema.parse({ workspace, name: "x", scope: "global" }).scope,
    ).toBe("global");
    expect(() => cfWorkflowsDeleteParamsSchema.parse({ workspace, name: "" })).toThrow();
    expect(cfWorkflowsDeleteResultSchema.parse({ ok: false, reason: "not_found" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("runs：scope 可选；limit 1..50、name 可选；行带归属字段 / cwd / args；truncated 只能是 true", () => {
    expect(cfWorkflowsRunsParamsSchema.parse({ workspace, limit: 1 })).toEqual({
      workspace,
      limit: 1,
    });
    expect(
      cfWorkflowsRunsParamsSchema.parse({ workspace, limit: 1, scope: "global" }).scope,
    ).toBe("global");
    expect(() =>
      cfWorkflowsRunsParamsSchema.parse({ workspace, limit: 1, scope: "user" }),
    ).toThrow();
    expect(
      cfWorkflowsRunsParamsSchema.parse({
        workspace,
        name: "x",
        limit: CF_WORKFLOWS_RUNS_MAX_LIMIT,
      }).name,
    ).toBe("x");
    expect(() => cfWorkflowsRunsParamsSchema.parse({ workspace, limit: 0 })).toThrow();
    expect(() =>
      cfWorkflowsRunsParamsSchema.parse({
        workspace,
        limit: CF_WORKFLOWS_RUNS_MAX_LIMIT + 1,
      }),
    ).toThrow();
    expect(() => cfWorkflowsRunsParamsSchema.parse({ workspace, limit: 1.5 })).toThrow();
    const result = cfWorkflowsRunsResultSchema.parse({
      runs: [
        {
          runId: "r1",
          name: "x",
          status: "running",
          createdAt: 1,
          updatedAt: 2,
          spentTokens: 0,
          parentSessionId: "s1",
          toolCallId: "t1",
          args: { branch: "main" },
          cwd: "/repo/one",
        },
        { runId: "r2", status: "errored", createdAt: 1, updatedAt: 2, spentTokens: 10 },
      ],
      truncated: true,
    });
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0]?.cwd).toBe("/repo/one");
    expect(result.runs[1]).not.toHaveProperty("cwd");
    expect(result.truncated).toBe(true);
    expect(() => cfWorkflowsRunsResultSchema.parse({ runs: [], truncated: false })).toThrow();
    expect(cfWorkflowsRunsResultSchema.parse({ runs: [] })).toEqual({ runs: [] });
  });

  it("runs：行的 artifacts 可选、≤ 8 件、只认六个 kind，老行缺席仍可解析", () => {
    const withArtifacts = cfWorkflowsRunsResultSchema.parse({
      runs: [
        {
          runId: "r1",
          status: "completed",
          createdAt: 1,
          updatedAt: 2,
          spentTokens: 0,
          artifacts: [
            {
              id: "report",
              kind: "file",
              title: "审计报告",
              version: 2,
              contentType: "application/pdf",
            },
            { id: "perf", kind: "chart", version: 1 },
          ],
        },
        { runId: "r2", status: "errored", createdAt: 1, updatedAt: 2, spentTokens: 10 },
      ],
    });
    expect(withArtifacts.runs[0]?.artifacts).toHaveLength(2);
    expect(withArtifacts.runs[0]?.artifacts?.[0]?.kind).toBe("file");
    expect(withArtifacts.runs[0]?.artifacts?.[1]).not.toHaveProperty("contentType");
    expect(withArtifacts.runs[1]).not.toHaveProperty("artifacts");

    const row = (artifacts: unknown) => ({
      runs: [
        { runId: "r1", status: "completed", createdAt: 1, updatedAt: 2, spentTokens: 0, artifacts },
      ],
    });
    const nine = Array.from({ length: 9 }, (_, index) => ({
      id: `a${index}`,
      kind: "markdown" as const,
      version: 1,
    }));
    expect(() => cfWorkflowsRunsResultSchema.parse(row(nine))).toThrow();
    expect(
      cfWorkflowsRunsResultSchema.parse(row(nine.slice(0, 8))).runs[0]?.artifacts,
    ).toHaveLength(8);
    expect(() =>
      cfWorkflowsRunsResultSchema.parse(row([{ id: "a", kind: "video", version: 1 }])),
    ).toThrow();
    expect(() =>
      cfWorkflowsRunsResultSchema.parse(row([{ id: "a", kind: "file", version: 1, bytes: 12 }])),
    ).toThrow();
    expect(() =>
      cfWorkflowsRunsResultSchema.parse(row([{ id: "", kind: "file", version: 1 }])),
    ).toThrow();
    expect(() => cfWorkflowsRunsResultSchema.parse(row([{ id: "a", kind: "file" }]))).toThrow();
  });

  it("move：params 只有 workspace/name（无 to，全局→项目单向）；结果 ok 分支带 from/to，失败分支 reason 五态", () => {
    expect(cfWorkflowsMoveParamsSchema.parse({ workspace, name: "x" })).toEqual({
      workspace,
      name: "x",
    });
    expect(() =>
      cfWorkflowsMoveParamsSchema.parse({ workspace, name: "x", to: "global" }),
    ).toThrow();
    expect(() =>
      cfWorkflowsMoveParamsSchema.parse({ workspace, name: "x", to: "project" }),
    ).toThrow();

    const ok = cfWorkflowsMoveResultSchema.parse({
      ok: true,
      from: "/home/me/.cf/workflows/x.dwf.ts",
      to: "/repo/.cf/workflows/x.dwf.ts",
    });
    expect(ok).toEqual({
      ok: true,
      from: "/home/me/.cf/workflows/x.dwf.ts",
      to: "/repo/.cf/workflows/x.dwf.ts",
    });
    for (const reason of [
      "invalid_name",
      "not_found",
      "target_exists",
      "read_error",
      "write_error",
    ]) {
      expect(
        cfWorkflowsMoveResultSchema.parse({ ok: false, reason, path: "/p", detail: "why" }),
      ).toEqual({ ok: false, reason, path: "/p", detail: "why" });
    }
    expect(cfWorkflowsMoveResultSchema.parse({ ok: false, reason: "target_exists" })).toEqual({
      ok: false,
      reason: "target_exists",
    });
    expect(() => cfWorkflowsMoveResultSchema.parse({ ok: false, reason: "boom" })).toThrow();
    expect(() => cfWorkflowsMoveResultSchema.parse({ ok: true, from: "/a" })).toThrow();
    expect(() =>
      cfWorkflowsMoveResultSchema.parse({ ok: true, from: "/a", to: "/b", scope: "project" }),
    ).toThrow();
  });
});

// running it again」）。
describe("cf-protocol saving a run", () => {
  it("方法名固定", () => {
    expect(cfProtocolMethods.workflowsSave).toBe("workflows/save");
    expect(cfProtocolMethods.workflowsForRun).toBe("workflows/forRun");
  });

  it("save 入参：runId 取代脚本（不收 script），workspace 必带，scope / overwrite 可缺；strict", () => {
    const params = { workspace, runId: "run-1", name: "pr-review", meta: { description: "d" } };
    expect(cfWorkflowsSaveParamsSchema.parse(params)).toEqual(params);
    expect(
      cfWorkflowsSaveParamsSchema.parse({ ...params, scope: "global", overwrite: true }),
    ).toMatchObject({ scope: "global", overwrite: true });
    expect(() => cfWorkflowsSaveParamsSchema.parse({ ...params, script: "x" })).toThrow();
    const { workspace: _dropped, ...withoutWorkspace } = params;
    expect(() => cfWorkflowsSaveParamsSchema.parse(withoutWorkspace)).toThrow();
    expect(() => cfWorkflowsSaveParamsSchema.parse({ ...params, runId: "" })).toThrow();
  });

  it("save 结果：ok 分支带 overwritten 与可选的遮蔽方向；拒绝词表封闭", () => {
    expect(
      cfWorkflowsSaveResultSchema.parse({
        ok: true,
        name: "x",
        scope: "project",
        path: "/p",
        overwritten: false,
        shadowing: "hides_global",
      }),
    ).toMatchObject({ shadowing: "hides_global" });
    for (const reason of [
      "invalid_name",
      "run_not_found",
      "script_missing",
      "target_exists",
      "compile_failed",
      "write_error",
    ]) {
      expect(cfWorkflowsSaveResultSchema.parse({ ok: false, reason })).toEqual({
        ok: false,
        reason,
      });
    }
    expect(() => cfWorkflowsSaveResultSchema.parse({ ok: false, reason: "boom" })).toThrow();
  });

  it("forRun: candidates have an upper bound; all 3 result fields are optional (all missing means \"unsaved and unknown args\")", () => {
    const candidates = Array.from({ length: CF_WORKFLOWS_FOR_RUN_MAX_CANDIDATES }, (_, i) => ({
      name: `w${i}`,
    }));
    expect(
      cfWorkflowsForRunParamsSchema.parse({ workspace, runId: "r", candidates }).candidates,
    ).toHaveLength(CF_WORKFLOWS_FOR_RUN_MAX_CANDIDATES);
    expect(() =>
      cfWorkflowsForRunParamsSchema.parse({
        workspace,
        runId: "r",
        candidates: [...candidates, { name: "one-too-many" }],
      }),
    ).toThrow();
    expect(cfWorkflowsForRunResultSchema.parse({})).toEqual({});
    expect(
      cfWorkflowsForRunResultSchema.parse({
        entry: { name: "x", description: "d", scope: "project", path: "/p" },
        match: "script",
        runArgs: { base: "main" },
      }),
    ).toMatchObject({ match: "script", runArgs: { base: "main" } });
    expect(() => cfWorkflowsForRunResultSchema.parse({ match: "guess" })).toThrow();
  });
});
