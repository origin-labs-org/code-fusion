import { describe, expect, it } from "vitest";
import { parseSubagentMarkdown } from "../src/subagents/subagentMarkdown.js";

describe("Subagent official Markdown fields", () => {
  it.each(["null", "{}", "false"])("Ignores intermediate field %s; model is an official field, not a fallback", (value) => {
    const result = parseSubagentMarkdown({
      content: `---\nname: audit\ndescription: audit\nmodelSelection: ${value}\nmodel: personal:p/m\nthoughtLevel: high\n---\nAudit`,
      path: "/fixture/audit.md",
      scope: "user",
    });
    expect(result.agent?.modelSelection).toEqual({
      providerId: "personal:p",
      modelId: "m",
      options: { reasoningLevel: "high" },
    });
  });
});
