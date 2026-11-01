import { describe, expect, it } from "vitest";
import {
  parseSelectionSideSlashCommand,
  parseV4VisibleSlashCommand,
  v4QueuedCommandText,
} from "@/v4/slashCommands.js";

describe("parseV4VisibleSlashCommand", () => {
  it("parses /goal and /target into a goal command objective", () => {
    expect(parseV4VisibleSlashCommand("/goal 修复登录", [])).toMatchObject({
      kind: "sendGoalCommand",
      objective: "修复登录",
      displayText: "/goal 修复登录",
    });
    expect(parseV4VisibleSlashCommand("  /target 修复登录  ", [])).toMatchObject({
      kind: "sendGoalCommand",
      objective: "修复登录",
      displayText: "/target 修复登录",
    });
  });

  it("strips /goal replace from the objective but preserves display text", () => {
    expect(parseV4VisibleSlashCommand("/goal replace New goal", [])).toMatchObject({
      kind: "sendGoalCommand",
      objective: "新目标",
      displayText: "/goal replace New goal",
    });
  });

  it("maps the CLI /goal resume syntax to resumeGoal", () => {
    expect(parseV4VisibleSlashCommand("/goal resume", [])).toEqual({
      kind: "resumeGoal",
      displayText: "/goal resume",
    });
  });

  it("does not consume the removed UI-only /resume-goal alias", () => {
    expect(parseV4VisibleSlashCommand("/resume-goal", [])).toBeNull();
    expect(parseV4VisibleSlashCommand("/resumegoal", [])).toBeNull();
  });

  it("does not consume commands with attachments", () => {
    expect(
      parseV4VisibleSlashCommand("/goal 修复登录", [
        { ref: "cf-artifact://a", fileName: "a.txt", mime: "text/plain", bytes: 1 },
      ]),
    ).toBeNull();
  });

  it.each(["/plan", "  /PLAN  帮我做 X  ", "/planner 做普通Task"])(
    "does not interpret %s as a send-time command",
    (text) => {
      expect(parseV4VisibleSlashCommand(text)).toBeNull();
      expect(parseV4VisibleSlashCommand(text, [{ ref: "cf-artifact://a" }])).toBeNull();
      expect(parseV4VisibleSlashCommand(text, [], { contextAttachmentCount: 1 })).toBeNull();
    },
  );

  it("does not consume commands with web element contexts", () => {
    expect(
      parseV4VisibleSlashCommand("/goal 修复登录", [], {
        contextAttachmentCount: 1,
      }),
    ).toBeNull();
  });

  it("keeps queued goal command syntax when edited to objective-only text", () => {
    expect(v4QueuedCommandText("sendGoalCommand", "新目标")).toBe("/goal 新目标");
    expect(v4QueuedCommandText("sendGoalCommand", "/target New goal")).toBe("/target New goal");
    expect(v4QueuedCommandText("sendText", "新目标")).toBe("新目标");
  });
});

describe("parseSelectionSideSlashCommand", () => {
  const enabledCommandNames = ["side", "btw"] as const;

  it("parses both aliases and preserves internal whitespace", () => {
    expect(
      parseSelectionSideSlashCommand("  /SIDE  Hello\nContinue查One下  ", [], {
        enabledCommandNames,
      }),
    ).toEqual({
      command: "side",
      text: "Hello\nContinue查One下",
      displayText: "/SIDE  Hello\nContinue查One下",
    });
    expect(parseSelectionSideSlashCommand("/btw 请Continue", [], { enabledCommandNames })).toEqual({
      command: "btw",
      text: "请Continue",
      displayText: "/btw 请Continue",
    });
  });

  it("只消费带非空TextCharacter参Count的CompleteInput", () => {
    expect(parseSelectionSideSlashCommand("/side", [], { enabledCommandNames })).toBeNull();
    expect(
      parseSelectionSideSlashCommand("先说 /side Hello", [], { enabledCommandNames }),
    ).toBeNull();
    expect(
      parseSelectionSideSlashCommand("/sidekick Hello", [], { enabledCommandNames }),
    ).toBeNull();
  });

  it("存在AttachmentorStructures化Context时不消费 App Command", () => {
    expect(
      parseSelectionSideSlashCommand("/side Hello", [{ ref: "cf-artifact://a" }], {
        enabledCommandNames,
      }),
    ).toBeNull();
    expect(
      parseSelectionSideSlashCommand("/btw Hello", [], {
        contextAttachmentCount: 1,
        enabledCommandNames,
      }),
    ).toBeNull();
  });

  it("遵守 CLI 同名Command优先的有效 App Command集合", () => {
    expect(
      parseSelectionSideSlashCommand("/side Hello", [], { enabledCommandNames: ["btw"] }),
    ).toBeNull();
    expect(
      parseSelectionSideSlashCommand("/btw Hello", [], { enabledCommandNames: ["btw"] }),
    ).toMatchObject({ command: "btw", text: "你好" });
  });
});
