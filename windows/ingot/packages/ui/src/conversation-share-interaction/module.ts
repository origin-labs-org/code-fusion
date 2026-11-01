
export const conversationShareInteractionModule = {
  id: "conversation-share-interaction",
  requires: ["services", "shared", "ui"],
  provides: ["conversation-share-interaction"],
  publicEntrypoints: [
    "index.ts",
    "contract.ts",
    "ConversationSharePopover.tsx",
    "ConversationSharePreflightStatus.tsx",
    "conversationSharePopoverActions.ts",
    "conversationSharePreflightRequest.ts",
    "conversationSharePreflightResponse.ts",
  ],
} as const;
