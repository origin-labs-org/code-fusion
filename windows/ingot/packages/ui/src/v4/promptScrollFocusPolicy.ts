import type { InputRouting } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { ConversationComposerSendOptions } from "@/v4/ConversationComposer.js";

export interface PromptScrollFocusPolicyInput {
  draftMode: boolean;
  inputRoutingMode: InputRouting["mode"] | null;
  heldQueueDisposition?: ConversationComposerSendOptions["heldQueueDisposition"];
}

export function shouldFocusTimelineAfterComposerSend(input: PromptScrollFocusPolicyInput): boolean {
  if (input.draftMode) return true;
  if (input.heldQueueDisposition) return true;
  return input.inputRoutingMode === "startNow";
}
