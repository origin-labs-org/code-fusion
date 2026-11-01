import type { BotOutboundMessage } from "@origin-ai/cf-shared";

type ReplyTarget = Pick<BotOutboundMessage, "replyToMessageId" | "threadId" | "rootMessageId">;

export function getUnavailableReplyFallback(target: ReplyTarget): ReplyTarget | null {
  const current = target.replyToMessageId || (target.threadId ? target.rootMessageId : undefined);
  if (!current) return null;
  if (!target.threadId) return { ...target, replyToMessageId: undefined };
  if (!target.rootMessageId || current === target.rootMessageId) return null;
  return { ...target, replyToMessageId: target.rootMessageId };
}
