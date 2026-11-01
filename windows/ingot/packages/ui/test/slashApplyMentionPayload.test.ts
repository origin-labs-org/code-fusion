import { describe, expect, it } from "vitest";
import { buildSlashApplyMentionPayload } from "../src/lib/slashApplyMentionPayload.js";
import type { PromptInputSuggestionItem } from "../src/lib/promptInputTriggers.js";

describe("buildSlashApplyMentionPayload", () => {
  it("skill suggestion inserts existing $skill markdown", () => {
    const suggestion: PromptInputSuggestionItem = {
      id: "skill:glm:workspace:code-review",
      trigger: "/",
      value: "code-review",
      label: "$code-review",
      description: "Workspace · review code",
      data: {
        path: "/repo/.cf/skills/code-review/SKILL.md",
        scope: "workspace",
      },
    };

    const payload = buildSlashApplyMentionPayload(suggestion);

    expect(payload).toEqual({
      id: "skill:glm:workspace:code-review",
      category: "skills",
      label: "code-review",
      value: "code-review",
      markdown: "[$code-review](/repo/.cf/skills/code-review/SKILL.md)",
      description: "Workspace · review code",
      data: {
        path: "/repo/.cf/skills/code-review/SKILL.md",
        scope: "workspace",
      },
    });
  });

  it("subagent suggestion still inserts existing @agent markdown", () => {
    const suggestion: PromptInputSuggestionItem = {
      id: "subagent:abc",
      trigger: "/",
      value: "code-reviewer",
      label: "code-reviewer",
      description: "review code",
      data: {
        path: "./agents/code-reviewer.md",
        scope: "workspace",
        source: "user",
        model: "claude-sonnet",
      },
    };

    const payload = buildSlashApplyMentionPayload(suggestion);

    expect(payload).toEqual({
      id: "subagent:abc",
      category: "subagents",
      label: "code-reviewer",
      value: "code-reviewer",
      markdown: "@code-reviewer",
      description: "review code",
      data: {
        path: "./agents/code-reviewer.md",
        scope: "workspace",
        source: "user",
        model: "claude-sonnet",
      },
    });
  });

  it("slash command does not generate double slashes when already prefixed with /", () => {
    const suggestion: PromptInputSuggestionItem = {
      id: "slash:init",
      trigger: "/",
      value: "/init",
      label: "/init",
      description: "init",
    };
    const payload = buildSlashApplyMentionPayload(suggestion);
    expect(payload.category).toBe("commands");
    expect(payload.value).toBe("init");
    expect(payload.markdown).toBe("/init");
  });

  it("slash command 仍为 /name", () => {
    const suggestion: PromptInputSuggestionItem = {
      id: "slash:review",
      trigger: "/",
      value: "review",
      label: "/review",
      description: "run",
    };
    const payload = buildSlashApplyMentionPayload(suggestion);
    expect(payload.category).toBe("commands");
    expect(payload.markdown).toBe("/review");
  });
});
