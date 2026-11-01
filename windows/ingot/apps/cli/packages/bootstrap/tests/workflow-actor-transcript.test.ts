

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteSessionStore } from "@origin-ai/cf-adapters/storage";
import {
  createMessageId,
  createPartId,
  type MessageId,
  type MessagePart,
  type SessionId,
} from "@origin-ai/cf-contracts";
import { WorkflowError } from "@origin-ai/cf-dynamic-workflow";
import {
  seedActorTranscript,
  type ActorTranscriptStore,
} from "../src/app/workflow-actor-transcript.js";

const SOURCE = "sess-source" as SessionId;
const TARGET = "sess-target" as SessionId;
const CWD = "/tmp/dwf-seed";

type Store = ActorTranscriptStore & {
  close(): void;
  createSession(input: unknown): Promise<unknown>;
};

function seedId(sessionId: SessionId, index: number): MessageId {
  return createMessageId(`${sessionId}-seed-${index}`);
}

async function saveMessage(
  store: ActorTranscriptStore,
  input: {
    id: MessageId;
    sessionId: SessionId;
    text: string;
    at: number;
    
    partId?: MessagePart["id"];
  },
): Promise<void> {
  await store.saveMessage({
    id: input.id,
    sessionID: input.sessionId,
    role: "user",
    time: { created: input.at },
    path: { cwd: CWD, root: CWD },
  } as never);
  await store.savePart({
    id: input.partId ?? (`${input.id}_text` as MessagePart["id"]),
    sessionID: input.sessionId,
    messageID: input.id,
    type: "text",
    text: input.text,
    time: { start: input.at, end: input.at },
  } as never);
}

async function fillSource(store: ActorTranscriptStore, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await saveMessage(store, {
      id: `src-${index}` as MessageId,
      sessionId: SOURCE,
      text: `source ${index}`,
      at: index + 1,
    });
  }
}

async function fillSeeded(store: ActorTranscriptStore, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await saveMessage(store, {
      id: seedId(TARGET, index),
      sessionId: TARGET,
      text: `seeded ${index}`,
      at: index + 1,
      partId: createPartId(`${TARGET}-seed-${index}-0`),
    });
  }
}

async function textsOf(store: ActorTranscriptStore, sessionId: SessionId): Promise<string[]> {
  const messages = await store.messages({ sessionID: sessionId });
  return messages.map((message) =>
    message.parts.map((part) => (part.type === "text" ? part.text : "")).join(""),
  );
}

async function createSessionRow(store: Store, sessionId: SessionId): Promise<void> {
  await store.createSession({
    id: sessionId,
    projectID: "project_dwf_seed",
    slug: `slug-${sessionId}`,
    directory: CWD,
    path: CWD,
    title: `session ${sessionId}`,
    version: "test-version",
    time: { created: 1, updated: 1 },
  } as never);
}

async function withStore(body: (store: Store) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "cf-dwf-seed-"));
  const store = (await createSqliteSessionStore({
    dbPath: join(tempRoot, "session.sqlite"),
  })) as unknown as Store;
  try {
    await createSessionRow(store, SOURCE);
    await createSessionRow(store, TARGET);
    await body(store);
  } finally {
    store.close();
    await rm(tempRoot, { force: true, recursive: true });
  }
}

describe("seedActorTranscript — 跳过规则", () => {
  it("目标已有 ≥ messageCount 条 → 整段跳过（崩溃后 resume 的常态）", async () => {
    await withStore(async (store) => {
      await fillSource(store, 4);
      await fillSeeded(store, 3);

      const copied = await seedActorTranscript({
        seed: { sourceSessionId: SOURCE, messageCount: 3 },
        store,
        targetSessionId: TARGET,
      });
      expect(copied).toBeUndefined();
      expect(await textsOf(store, TARGET)).toEqual(["seeded 0", "seeded 1", "seeded 2"]);
    });
  });

  it("目标只有 k < N 条种子消息 → 补齐到 N", async () => {
    await withStore(async (store) => {
      await fillSource(store, 4);
      await fillSeeded(store, 1);

      const copied = await seedActorTranscript({
        seed: { sourceSessionId: SOURCE, messageCount: 3 },
        store,
        targetSessionId: TARGET,
      });
      expect(copied).toBe(3);
      expect(await textsOf(store, TARGET)).toEqual(["source 0", "source 1", "source 2"]);
    });
  });

  it("目标是 N 条种子消息、边界长到 M > N → 延长到 M", async () => {
    await withStore(async (store) => {
      await fillSource(store, 5);
      await fillSeeded(store, 2);

      const copied = await seedActorTranscript({
        seed: { sourceSessionId: SOURCE, messageCount: 4 },
        store,
        targetSessionId: TARGET,
      });
      expect(copied).toBe(4);
      expect(await textsOf(store, TARGET)).toEqual([
        "source 0",
        "source 1",
        "source 2",
        "source 3",
      ]);
    });
  });

  
  it("目标已有自己的 live 消息 → 一个字节都不写，哪怕总条数不足 messageCount", async () => {
    await withStore(async (store) => {
      await fillSource(store, 9);
      await fillSeeded(store, 2);
      await saveMessage(store, {
        id: "live-0" as MessageId,
        sessionId: TARGET,
        text: "live 0",
        at: 10,
      });
      await saveMessage(store, {
        id: "live-1" as MessageId,
        sessionId: TARGET,
        text: "live 1",
        at: 11,
      });
      const before = await textsOf(store, TARGET);

      const copied = await seedActorTranscript({
        seed: { sourceSessionId: SOURCE, messageCount: 7 },
        store,
        targetSessionId: TARGET,
      });
      expect(copied).toBeUndefined();
      expect(await textsOf(store, TARGET)).toEqual(before);
      expect(await textsOf(store, TARGET)).toEqual(["seeded 0", "seeded 1", "live 0", "live 1"]);
    });
  });

  it("空目标照常复制", async () => {
    await withStore(async (store) => {
      await fillSource(store, 3);

      const copied = await seedActorTranscript({
        seed: { sourceSessionId: SOURCE, messageCount: 2 },
        store,
        targetSessionId: TARGET,
      });
      expect(copied).toBe(2);
      expect(await textsOf(store, TARGET)).toEqual(["source 0", "source 1"]);
    });
  });

  it("源会话短于边界 → DriverError", async () => {
    await withStore(async (store) => {
      await fillSource(store, 2);

      await expect(
        seedActorTranscript({
          seed: { sourceSessionId: SOURCE, messageCount: 5 },
          store,
          targetSessionId: TARGET,
        }),
      ).rejects.toThrow(WorkflowError);
      expect(await textsOf(store, TARGET)).toEqual([]);
    });
  });

  it("跳过写进已开跑会话时记一条 warn（边界长大的唯一可见处）", async () => {
    await withStore(async (store) => {
      await fillSource(store, 9);
      await fillSeeded(store, 1);
      await saveMessage(store, {
        id: "live-0" as MessageId,
        sessionId: TARGET,
        text: "live 0",
        at: 10,
      });
      const warnings: { message: string; context?: Record<string, unknown> }[] = [];

      await seedActorTranscript({
        logger: {
          warn: (message: string, context?: Record<string, unknown>) =>
            warnings.push({ message, context }),
        } as never,
        seed: { sourceSessionId: SOURCE, messageCount: 7 },
        store,
        targetSessionId: TARGET,
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.context).toMatchObject({
        event: "dynamic_workflow.actor.seed_skipped_live_session",
        existingMessageCount: 2,
        messageCount: 7,
      });
    });
  });
});
