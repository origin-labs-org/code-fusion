

import { describe, expect, it } from "vitest";
import { CF_DWF_CHILD_COMMAND } from "@origin-ai/cf-contracts";
import { dynamicWorkflowChildSpawn } from "../src/app/dynamic-workflow-run-launch.js";

describe("dynamicWorkflowChildSpawn", () => {
  it("SEA 下给出隐藏子命令作为 argsPrefix", () => {
    expect(dynamicWorkflowChildSpawn(true)).toEqual({ argsPrefix: [CF_DWF_CHILD_COMMAND] });
  });

  it("非 SEA 下完全不表态（harness 走缺省的 node <entry> 形状）", () => {
    expect(dynamicWorkflowChildSpawn(false)).toBeUndefined();
  });

  it("默认探针在普通 node 进程里判定为非 SEA", () => {
    expect(dynamicWorkflowChildSpawn()).toBeUndefined();
  });
});
