// ============================================================
// ============================================================
//
//
//
//

import {
  createMessageId,
  createPartId,
  type Logger,
  type MessageId,
  type MessageInfo,
  type MessagePart,
  type MessageWithParts,
  type PartId,
  type SessionId,
} from "@origin-ai/cf-contracts";
import { cloneMessageForFork, clonePartForFork } from "@origin-ai/cf-core";
import { WorkflowError, type ActorSessionSeed } from "@origin-ai/cf-dynamic-workflow";

export interface ActorTranscriptStore {
  messages(input: { sessionID: SessionId }): Promise<MessageWithParts[]>;
  saveMessage(input: MessageInfo): Promise<void>;
  savePart(input: MessagePart): Promise<void>;
}

export async function countActorTranscript(
  store: ActorTranscriptStore,
  sessionId: SessionId,
): Promise<number> {
  return (await store.messages({ sessionID: sessionId })).length;
}

export async function seedActorTranscript(input: {
  logger?: Logger;
  seed: ActorSessionSeed;
  store: ActorTranscriptStore;
  targetSessionId: SessionId;
}): Promise<number | undefined> {
  const { logger, seed, store, targetSessionId } = input;
  const existing = await store.messages({ sessionID: targetSessionId });
  if (existing.length >= seed.messageCount) return undefined;
  if (!holdsOnlySeedMessages(existing, targetSessionId)) {
    logger?.warn?.("Dynamic workflow actor session already has its own history; seeding skipped", {
      event: "dynamic_workflow.actor.seed_skipped_live_session",
      existingMessageCount: existing.length,
      messageCount: seed.messageCount,
      module: "bootstrap.app",
      sessionId: targetSessionId,
    });
    return undefined;
  }

  const source = await store.messages({ sessionID: seed.sourceSessionId as SessionId });
  if (source.length < seed.messageCount) {
    throw new WorkflowError(
      "DriverError",
      `Cannot seed the subagent transcript: source session ${seed.sourceSessionId} has only ` +
        `${source.length} messages, but the boundary requires the first ${seed.messageCount}.`,
      { mismatch: { expected: String(seed.messageCount), got: String(source.length) } },
    );
  }

  const messageIds = new Map<MessageId, MessageId>();
  for (let index = 0; index < seed.messageCount; index++) {
    const message = source[index]!;
    const nextMessageId = seededMessageId(targetSessionId, index);
    const cloned = cloneMessageForFork(message.info, {
      forkedSessionId: targetSessionId,
      messageIdMap: messageIds,
      nextMessageId,
    });
    messageIds.set(message.info.id, nextMessageId);
    await store.saveMessage(cloned);
    for (const [partIndex, part] of message.parts.entries()) {
      await store.savePart(
        clonePartForFork(part, {
          forkedSessionId: targetSessionId,
          messageIdMap: messageIds,
          nextMessageId,
          nextPartId: seededPartId(targetSessionId, index, partIndex),
        }),
      );
    }
  }
  return seed.messageCount;
}

function holdsOnlySeedMessages(
  existing: readonly MessageWithParts[],
  targetSessionId: SessionId,
): boolean {
  return existing.every(
    (message, index) => message.info.id === seededMessageId(targetSessionId, index),
  );
}

function seededMessageId(targetSessionId: SessionId, index: number): MessageId {
  return createMessageId(`${targetSessionId}-seed-${index}`);
}

function seededPartId(targetSessionId: SessionId, index: number, partIndex: number): PartId {
  return createPartId(`${targetSessionId}-seed-${index}-${partIndex}`);
}
