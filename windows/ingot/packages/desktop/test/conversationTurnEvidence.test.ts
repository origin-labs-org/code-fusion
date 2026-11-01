import { describe, expect, it } from "vitest";
import { hasAssistantReplyForUserTurn } from "./e2e/helpers/conversation-turn-evidence.js";

describe("Follow-up must have a new reply for this turn", () => {
  it("旧回复和新 user 行不能冒充新回复", () => {
    expect(
      hasAssistantReplyForUserTurn(
        [
          { role: "user", text: "FIRST" },
          { role: "assistant", text: "SAME_REPLY" },
          { role: "user", text: "FOLLOW:turn-1:" },
        ],
        "FOLLOW:turn-1:",
        "SAME_REPLY",
      ),
    ).toBe(false);
  });
  it("Only replies after the corresponding new user pass", () => {
    expect(
      hasAssistantReplyForUserTurn(
        [
          { role: "assistant", text: "SAME_REPLY" },
          { role: "user", text: "FOLLOW:turn-1:" },
          { role: "assistant", text: "SAME_REPLY" },
        ],
        "FOLLOW:turn-1:",
        "SAME_REPLY",
      ),
    ).toBe(true);
  });
  it("Replies following duplicate user or another input cannot count as success for current turn", () => {
    expect(
      hasAssistantReplyForUserTurn(
        [
          { role: "user", text: "FOLLOW:turn-1:" },
          { role: "user", text: "FOLLOW:turn-1:" },
          { role: "assistant", text: "SAME_REPLY" },
        ],
        "FOLLOW:turn-1:",
        "SAME_REPLY",
      ),
    ).toBe(false);
    expect(
      hasAssistantReplyForUserTurn(
        [
          { role: "user", text: "FOLLOW:turn-1:" },
          { role: "user", text: "ANOTHER_TURN" },
          { role: "assistant", text: "SAME_REPLY" },
        ],
        "FOLLOW:turn-1:",
        "SAME_REPLY",
      ),
    ).toBe(false);
  });
});
