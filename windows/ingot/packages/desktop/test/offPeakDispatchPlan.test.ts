import { describe, expect, it } from "vitest";
import { OffPeakPermanentDispatchError } from "@origin-ai/cf-services/node";
import {
  assertBoundSessionDispatchable,
  OffPeakBoundSessionBusyError,
  OffPeakBoundSessionDeletedError,
  resolveOffPeakDispatchKind,
} from "../src/host/offPeakDispatchPlan.js";

describe("resolveOffPeakDispatchKind (D50 bind first run branch)", () => {
  it("conversationId backfilled → resume; sessionId only → bind first run; both empty → new session", () => {
    expect(resolveOffPeakDispatchKind({ conversationId: "sess", sessionId: "sess" })).toBe("resume");
    expect(resolveOffPeakDispatchKind({ sessionId: "sess" })).toBe("bound-first-run");
    expect(resolveOffPeakDispatchKind({})).toBe("init");
    expect(resolveOffPeakDispatchKind({ sessionId: "  " })).toBe("init");
  });
});

describe("assertBoundSessionDispatchable", () => {
  it("会话已删除 → permanent（不再退避重试）", () => {
    expect(() =>
      assertBoundSessionDispatchable({ sessionId: "sess", deleted: true, running: false }),
    ).toThrow(OffPeakBoundSessionDeletedError);
    expect(new OffPeakBoundSessionDeletedError("sess")).toBeInstanceOf(OffPeakPermanentDispatchError);
  });

  it("Session busy → transient busy, and not permanent", () => {
    expect(() =>
      assertBoundSessionDispatchable({ sessionId: "sess", deleted: false, running: true }),
    ).toThrow(OffPeakBoundSessionBusyError);
    expect(new OffPeakBoundSessionBusyError("sess")).not.toBeInstanceOf(
      OffPeakPermanentDispatchError,
    );
  });

  it("Idle and exists → allow", () => {
    expect(() =>
      assertBoundSessionDispatchable({ sessionId: "sess", deleted: false, running: false }),
    ).not.toThrow();
  });
});
