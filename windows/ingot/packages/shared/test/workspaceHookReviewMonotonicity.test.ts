import { describe, expect, it } from "vitest";
import {
  verdictWorkspaceHookReviewRequest,
  type WorkspaceHookReviewIdentity,
} from "../src/workspace-hook-review-monotonicity.js";

const current: WorkspaceHookReviewIdentity = {
  reviewFlowId: "flow-a",
  generation: 2,
  interactionId: "interaction-2",
};

describe("workspace Hook review monotonicity arbitration (D16 single source of truth)", () => {
  it("无当前权威时任何 candidate 都可接管", () => {
    expect(
      verdictWorkspaceHookReviewRequest(undefined, {
        reviewFlowId: "flow-a",
        generation: 1,
        interactionId: "interaction-1",
      }),
    ).toBe("no_current");
  });

  it("Higher generation in the same flow is accepted (supersede)", () => {
    expect(
      verdictWorkspaceHookReviewRequest(current, {
        reviewFlowId: "flow-a",
        generation: 3,
        interactionId: "interaction-3",
      }),
    ).toBe("same_flow_advance");
  });

  it("Reject lower generation in same flow (late event)", () => {
    expect(
      verdictWorkspaceHookReviewRequest(current, {
        reviewFlowId: "flow-a",
        generation: 1,
        interactionId: "interaction-1",
      }),
    ).toBe("same_flow_stale");
  });

  it("同 generation 同 interactionId 是幂等 replay", () => {
    expect(
      verdictWorkspaceHookReviewRequest(current, {
        reviewFlowId: "flow-a",
        generation: 2,
        interactionId: "interaction-2",
      }),
    ).toBe("same_flow_replay");
  });

  it("Changing interactionId in same generation violates controller monotonicity", () => {
    expect(
      verdictWorkspaceHookReviewRequest(current, {
        reviewFlowId: "flow-a",
        generation: 2,
        interactionId: "interaction-other",
      }),
    ).toBe("same_flow_conflict");
  });

  it("Cross-flow is always cross_flow, regardless of higher or lower generation", () => {
    expect(
      verdictWorkspaceHookReviewRequest(current, {
        reviewFlowId: "flow-b",
        generation: 1,
        interactionId: "interaction-1",
      }),
    ).toBe("cross_flow");
    expect(
      verdictWorkspaceHookReviewRequest(current, {
        reviewFlowId: "flow-b",
        generation: 9,
        interactionId: "interaction-9",
      }),
    ).toBe("cross_flow");
  });
});
