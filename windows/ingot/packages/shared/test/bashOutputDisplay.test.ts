import { describe, expect, it } from "vitest";
import { cfSessionEventSchema } from "../src/cf-protocol/index.js";
import { conversationRowSchema } from "../src/cf-protocol-v4/index.js";

const display = {
  kind: "bash_output",
  output: "head",
  truncated: true,
  outputPath: "C:\\Chinese 空格\\output.log",
};
function parseBoth(value: unknown) {
  const event = {
    eventId: "bash-result-event",
    type: "tool.updated",
    sessionId: "session",
    seq: 1,
    timestamp: 1,
    payload: {
      kind: "result",
      toolCallId: "bash",
      toolName: "Bash",
      duration: 1,
      result: { success: true, content: "model preview", display: value },
    },
  };
  const row = {
    kind: "toolCall",
    rowId: 1,
    turnId: "turn",
    createdAt: 1,
    createdAtSeq: 1,
    toolCallId: "bash",
    toolName: "Bash",
    inputText: "",
    status: "success",
    output: { text: "model preview", display: value },
  };
  return [cfSessionEventSchema.safeParse(event), conversationRowSchema.safeParse(row)];
}
describe("Bash output display wire contract", () => {
  it("preserves display on the legacy event and V4 row", () => {
    for (const parsed of parseBoth(display)) {
      expect(parsed.success).toBe(true);
      expect(JSON.stringify(parsed)).toContain(JSON.stringify(display));
    }
  });
  it.each([
    { ...display, output: "x".repeat(150001) },
    { ...display, truncated: "true" },
    { ...display, outputPath: "" },
    { ...display, unbounded: true },
  ])("两条通道都不携带越界/畸形 display", (invalid) => {
    const [event, row] = parseBoth(invalid);
    expect(event.success).toBe(false);
    expect(row.success).toBe(true);
    if (row.success && row.data.kind === "toolCall") {
      expect(row.data.output?.display).toBeUndefined();
    }
  });
});
