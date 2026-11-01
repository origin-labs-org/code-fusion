//
//

import { describe, expect, it } from "vitest";
import {
  conversationTopicFrameSchema,
  isDeterministicContentFault,
  reassembleTopicWireFrames,
  SUBSCRIPTION_CONTENT_REJECTED,
  TopicWireFrameAssembler,
  WIRE_FAULT_INVALID_PAYLOAD,
  type ConversationTopicWireFrame,
} from "../src/cf-protocol-v4/index.js";

const TOPIC = "conversation/session-wire-fault";
const SUBSCRIPTION_ID = "sub-wire-fault";

function schemaInvalidWire(): ConversationTopicWireFrame {
  return {
    wireVersion: 3,
    kind: "complete",
    deliveryKind: "online",
    logicalFrameId: "logical-wire-fault",
    logicalFrameOrdinal: 1,
    topic: TOPIC,
    subscriptionId: SUBSCRIPTION_ID,
    frame: {
      topic: TOPIC,
      subscriptionId: SUBSCRIPTION_ID,
      fromSeq: 1,
      toSeq: 2,
      sentAt: 1,
      payload: { kind: "not-a-real-payload-kind" },
    },
  } as unknown as ConversationTopicWireFrame;
}

describe("确定性内容 fault 的分类", () => {
  it.each([
    "proto.frameAssemblyInvalidJson",
    "proto.frameAssemblyChecksumMismatch",
    "proto.frameAssemblyLengthMismatch",
    "proto.frameAssemblyTooLarge",
    "proto.frameAssemblyTimedOut",
    "proto.frameAssemblyMetadataMismatch",
    "proto.frameAssemblySuperseded",
  ])("%s 仍按瞬态处理", (reasonCode) => {
    expect(isDeterministicContentFault(reasonCode)).toBe(false);
  });

  it("缺失的 reasonCode 不算确定性失败（未知就按瞬态，保留自愈路径）", () => {
    expect(isDeterministicContentFault(undefined)).toBe(false);
  });

  it("两个终态 code 是不同的词：内容失败不该被聚合成一次链路抖动", () => {
    expect(SUBSCRIPTION_CONTENT_REJECTED).not.toBe("fault.subscription.recoveryFailed");
    expect(SUBSCRIPTION_CONTENT_REJECTED).toMatch(/^fault\.[A-Za-z0-9._-]+$/);
  });
});

describe("产出侧与判定侧用同一个 reason code", () => {
  it("incremental assembler 的 schema 拒收产出可被判定为内容失败", () => {
    const assembler = new TopicWireFrameAssembler(conversationTopicFrameSchema);
    const events = assembler.accept(schemaInvalidWire());
    const fault = events.find((event) => event.kind === "fault");
    expect(fault).toBeDefined();
    if (fault?.kind !== "fault") return;
    expect(fault.fault.reasonCode).toBe(WIRE_FAULT_INVALID_PAYLOAD);
    expect(isDeterministicContentFault(fault.fault.reasonCode)).toBe(true);
  });

  it("一次性 reassemble 的 schema 拒收同样可被判定", () => {
    const result = reassembleTopicWireFrames([schemaInvalidWire()], conversationTopicFrameSchema);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reasonCode).toBe(WIRE_FAULT_INVALID_PAYLOAD);
    expect(isDeterministicContentFault(result.reasonCode)).toBe(true);
  });
});
