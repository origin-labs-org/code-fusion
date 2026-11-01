//
import type { DeliveryProfile } from "./core.js";
import type { ConversationDelta } from "./delta.js";
import type { ConversationRow } from "./rows.js";

export function filterConversationRowsForProfile(
  rows: readonly ConversationRow[],
  _profile: DeliveryProfile,
): ConversationRow[] {
  return [...rows];
}

export function filterConversationDeltasForProfile(
  deltas: readonly ConversationDelta[],
  profile: DeliveryProfile,
): ConversationDelta[] {
  return deltas.filter((delta) => {
    if (delta.op === "row.delta") return profile.streamPaths[delta.path];
    return true;
  });
}
