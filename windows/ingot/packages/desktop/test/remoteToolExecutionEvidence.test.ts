import { describe, expect, it } from "vitest";
import { parseRemoteToolExecutionEvents } from "./e2e/helpers/remote-tool-execution-evidence.js";

const query = { toolCallId: "permission-write", toolName: "Write" };
const encode = (...rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n");

describe("Actual tool execution count after permission recovery", () => {
  it("Overwriting the same file twice still retains two executions and cannot falsely pass on a single file line", () => {
    const started = { event: "tool.call.started", ...query };
    const completed = { event: "tool.call.completed", context: query };
    const events = parseRemoteToolExecutionEvents(
      encode(started, completed, started, completed),
      query,
    );
    expect(events.filter((event) => event.event === "tool.call.started")).toHaveLength(2);
    expect(events.filter((event) => event.event === "tool.call.completed")).toHaveLength(2);
  });
  it("Only count formal execution events for corresponding Write, excluding other calls and permission metadata", () => {
    const events = parseRemoteToolExecutionEvents(
      encode(
        { event: "tool.permission.resolved", ...query },
        { event: "tool.call.started", ...query, toolCallId: "another-write" },
        { event: "tool.call.started", ...query, toolName: "Read" },
        { event: "tool.call.started", context: query },
        { event: "tool.call.completed", ...query },
      ),
      query,
    );
    expect(events.map((event) => event.event)).toEqual([
      "tool.call.started",
      "tool.call.completed",
    ]);
  });
  it("日志损坏不能默认为零次执行", () => {
    expect(() => parseRemoteToolExecutionEvents("broken-json", query)).toThrow();
    expect(parseRemoteToolExecutionEvents("", query)).toEqual([]);
  });
  it("Re-writing with a different toolCallId in the same task is still counted; other tasks must not be mixed in", () => {
    const events = parseRemoteToolExecutionEvents(
      encode(
        { event: "tool.call.started", toolCallId: "first", toolName: "Write", sessionId: "task-a" },
        {
          event: "tool.call.started",
          toolCallId: "second",
          toolName: "Write",
          sessionId: "task-a",
        },
        { event: "tool.call.started", toolCallId: "other", toolName: "Write", sessionId: "task-b" },
      ),
      { sessionId: "task-a", toolName: "Write" },
    );
    expect(events.map((event) => event.toolCallId)).toEqual(["first", "second"]);
  });
});
