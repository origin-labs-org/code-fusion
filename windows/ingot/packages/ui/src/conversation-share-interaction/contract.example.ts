import type { ConversationSharePreflightRequest } from "@/conversation-share-interaction/contract.js";
import { scheduleConversationSharePreflightRequest } from "@/conversation-share-interaction/conversationSharePreflightRequest.js";

export function beginSharePreflight<T>(owner: ConversationSharePreflightRequest<T>): () => void {
  return scheduleConversationSharePreflightRequest(owner);
}
