import type { CfSessionStateSnapshot } from "./cf-protocol/index.js";
import type { CfMessagePart, CfMessageWithParts } from "./cf-protocol-legacy-types.js";

export type CfSessionContentProfile = "full" | "index";

const ELIDED_DATA_URL = "data:,";

function elidePartForIndex(part: CfMessagePart): CfMessagePart {
  switch (part.type) {
    case "reasoning":
      return part.text ? { ...part, text: "" } : part;
    case "file":
      return part.url.startsWith("data:") && part.url !== ELIDED_DATA_URL
        ? { ...part, url: ELIDED_DATA_URL }
        : part;
    case "tool": {
      const state = part.state;
      switch (state.status) {
        case "pending":
          return { ...part, state: { ...state, input: {}, raw: "" } };
        case "running":
          return {
            ...part,
            state: { ...state, input: {}, ...(state.metadata ? { metadata: {} } : {}) },
          };
        case "completed":
          return { ...part, state: { ...state, input: {}, output: "", metadata: {} } };
        case "error":
          return {
            ...part,
            state: { ...state, input: {}, error: "", ...(state.metadata ? { metadata: {} } : {}) },
          };
        default:
          return part;
      }
    }
    default:
      return part;
  }
}

function elideMessageForIndex(message: CfMessageWithParts): CfMessageWithParts {
  let changed = false;
  const parts = message.parts.map((part) => {
    const next = elidePartForIndex(part);
    if (next !== part) changed = true;
    return next;
  });
  return changed ? { ...message, parts } : message;
}

export function elideSessionSnapshotForIndex<T extends CfSessionStateSnapshot>(snapshot: T): T {
  return { ...snapshot, messages: snapshot.messages.map(elideMessageForIndex) };
}
