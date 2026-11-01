import { InMemorySessionEventStore, type SessionEventStorePort } from "@origin-ai/cf-contracts";

export function createTestSessionEventStore(): SessionEventStorePort {
  return new InMemorySessionEventStore({ retention: "unbounded" });
}
