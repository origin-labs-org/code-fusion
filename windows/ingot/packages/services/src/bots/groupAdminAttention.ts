import type { BotActor, BotOutboundMessage } from "@origin-ai/cf-shared";

export class BotAdminRequiredError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

export class BotReplyError extends Error {
  constructor(public readonly replies: BotOutboundMessage[]) {
    super(replies.map((reply) => reply.text).join("\n"));
  }
}

export function createGroupAdminAttention() {
  const sent = new Map<string, true>();
  const scope = (actor: BotActor, owner: string) =>
    JSON.stringify([actor.botId, actor.chatId, actor.threadId, owner]);
  return {
    mention(actor: BotActor, owner: string | undefined, reason: string): string[] | undefined {
      if (actor.chatType !== "group" || !actor.chatId || !owner) return undefined;
      const key = `${scope(actor, owner)}:${reason}`;
      if (sent.has(key)) return [];
      sent.set(key, true);
      if (sent.size > 1000) sent.delete(sent.keys().next().value!);
      return [owner];
    },
    clear(actor?: BotActor, owner?: string, reason?: string) {
      if (!actor) {
        sent.clear();
        return;
      }
      if (!owner) return;
      const prefix = `${scope(actor, owner)}:`;
      for (const key of sent.keys()) {
        if (
          reason
            ? key === `${prefix}${reason}`
            : key.startsWith(prefix) &&
              !key.slice(prefix.length).startsWith("permission:") &&
              !key.slice(prefix.length).startsWith("plan:")
        )
          sent.delete(key);
      }
    },
  };
}
