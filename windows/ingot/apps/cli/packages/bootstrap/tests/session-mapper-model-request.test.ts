import { describe, expect, it } from "vitest";
import { SessionEventType, createSessionEvent, type SessionId } from "@origin-ai/cf-contracts";
import { mapSessionEvent } from "../src/cf-protocol/session-mapper.js";

const sessionId = "session_mapper_model_request" as SessionId;

describe("session-mapper model_request", () => {
  it("RET-012 瘦身 payload 与完整 payload 映射出相同的 messageCount", () => {
    const full = createSessionEvent(SessionEventType.ModelRequest, sessionId, {
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ],
      providerId: "p",
      modelId: "m",
      toolCount: 2,
    });
    const slim = createSessionEvent(SessionEventType.ModelRequest, sessionId, {
      messageCount: 3,
      providerId: "p",
      modelId: "m",
      toolCount: 2,
    });
    expect(mapSessionEvent(slim).payload).toEqual(mapSessionEvent(full).payload);
    expect(mapSessionEvent(slim).payload).toMatchObject({ messageCount: 3 });
  });
});
