

import { describe, expect, it } from "vitest";
import {
  DYNAMIC_WORKFLOW_RUN_LABEL_MAX_CHARS,
  resolveDynamicWorkflowRunLabel,
} from "../src/app/dynamic-workflow-run-label.js";

const RUN_ID = "dwfrun-0f2a";

describe("resolveDynamicWorkflowRunLabel", () => {
  it("name 命中即用它，labelSource 为 name", () => {
    expect(
      resolveDynamicWorkflowRunLabel({
        runId: RUN_ID,
        name: "nightly triage",
        scriptText: "return 1;",
      }),
    ).toEqual({ label: "nightly triage", labelSource: "name" });
  });

  it("When name is absent, take script\'s first non-empty line; labelSource is script", () => {
    expect(
      resolveDynamicWorkflowRunLabel({
        runId: RUN_ID,
        scriptText: '\n\n   // triage the failing tests   \nconst a = agent("worker");',
      }),
    ).toEqual({ label: "// triage the failing tests", labelSource: "script" });
  });

  it("首行按 80 字符截断", () => {
    const line = "x".repeat(200);
    const { label } = resolveDynamicWorkflowRunLabel({ runId: RUN_ID, scriptText: line });
    expect(label).toHaveLength(DYNAMIC_WORKFLOW_RUN_LABEL_MAX_CHARS);
    expect(label).toBe("x".repeat(DYNAMIC_WORKFLOW_RUN_LABEL_MAX_CHARS));
  });

  it("截断不留下孤立代理项", () => {
    const line = `${"a".repeat(DYNAMIC_WORKFLOW_RUN_LABEL_MAX_CHARS - 1)}😀tail`;
    const { label } = resolveDynamicWorkflowRunLabel({ runId: RUN_ID, scriptText: line });
    expect(label).toBe("a".repeat(DYNAMIC_WORKFLOW_RUN_LABEL_MAX_CHARS - 1));
  });

  it("Blank name is treated as unnamed, falling back to script\'s first line", () => {
    expect(
      resolveDynamicWorkflowRunLabel({ runId: RUN_ID, name: "   ", scriptText: "return 7;" }),
    ).toEqual({ label: "return 7;", labelSource: "script" });
  });

  it("name 与脚本都缺席时退回 runId，labelSource 仍是 script", () => {
    expect(resolveDynamicWorkflowRunLabel({ runId: RUN_ID })).toEqual({
      label: RUN_ID,
      labelSource: "script",
    });
    expect(resolveDynamicWorkflowRunLabel({ runId: RUN_ID, scriptText: "  \n\t\n " })).toEqual({
      label: RUN_ID,
      labelSource: "script",
    });
  });
});
