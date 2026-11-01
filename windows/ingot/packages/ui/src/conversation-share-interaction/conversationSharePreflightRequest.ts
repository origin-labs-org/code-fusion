import type { ConversationSharePreflightRequest } from "@/conversation-share-interaction/contract.js";

export function scheduleConversationSharePreflightRequest<T>(
  options: ConversationSharePreflightRequest<T>,
): () => void {
  let active = true;
  const timer = setTimeout(() => {
    void Promise.resolve()
      .then(options.request)
      .then(
        (result) => {
          if (active) options.onResolved(result);
        },
        (error: unknown) => {
          if (active) options.onRejected(error);
        },
      )
      .catch((error: unknown) => {
        if (active) options.onError(error);
      });
  }, 150);
  return () => {
    active = false;
    clearTimeout(timer);
  };
}
