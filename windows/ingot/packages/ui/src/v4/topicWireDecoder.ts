import {
  TopicWireFrameAssembler,
  type TopicWireAssemblyEvent,
  type TopicWireAssemblyFault,
  type TopicFrameDeliveryKind,
  type TopicWireFrameCandidate,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { logger } from "@/logger.js";

export interface TopicWireDecoder {
  accept(wire: TopicWireFrameCandidate): void;
  
  recover(topic: string, subscriptionId: string): void;
  discard(topic: string, subscriptionId: string): void;
  clear(): void;
}

export function createTopicWireDecoder<F extends { topic: string; subscriptionId: string }>(
  assembler: TopicWireFrameAssembler<F>,
  deliver: (frame: F, deliveryKind: TopicFrameDeliveryKind) => void,
  onFault?: (fault: TopicWireAssemblyFault) => void,
): TopicWireDecoder {
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  const faultedRoutes = new Set<string>();
  const routeKey = (topic: string, subscriptionId: string) => `${topic}\0${subscriptionId}`;

  const handleEvents = (events: TopicWireAssemblyEvent<F>[]): void => {
    const faults = events.filter((event) => event.kind === "fault");
    const failedInBatch = new Set<string>();
    const healingRoutes = new Set<string>();
    for (const event of events) {
      if (event.kind === "complete" && event.deliveryKind === "recovery") {
        healingRoutes.add(routeKey(event.frame.topic, event.frame.subscriptionId));
      }
    }
    for (const { fault } of faults) {
      const key = routeKey(fault.topic, fault.subscriptionId);
      if (healingRoutes.has(key)) continue;
      failedInBatch.add(key);
      faultedRoutes.add(key);
      assembler.abort(fault.topic, fault.subscriptionId);
      logger.warn("[v4-topic-wire] physical assembly rejected", fault);
      onFault?.(fault);
    }
    for (const event of events) {
      if (event.kind !== "complete") continue;
      const key = routeKey(event.frame.topic, event.frame.subscriptionId);
      if (event.deliveryKind === "recovery") faultedRoutes.delete(key);
      if (failedInBatch.has(key) || faultedRoutes.has(key)) continue;
      deliver(event.frame, event.deliveryKind);
    }
  };

  const scheduleExpiry = (): void => {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    const nextExpiryAt = assembler.nextExpiryAt;
    if (nextExpiryAt === null) return;
    expiryTimer = setTimeout(
      () => {
        expiryTimer = null;
        handleEvents(assembler.expire(Date.now()));
        scheduleExpiry();
      },
      Math.max(0, nextExpiryAt - Date.now()),
    );
  };

  return {
    accept(wire) {
      const key = routeKey(wire.topic, wire.subscriptionId);
      if (faultedRoutes.has(key)) {
        if (wire.deliveryKind !== "recovery") return;
        faultedRoutes.delete(key);
        assembler.abort(wire.topic, wire.subscriptionId);
      }
      handleEvents(assembler.accept(wire));
      scheduleExpiry();
    },
    recover(topic, subscriptionId) {
      faultedRoutes.delete(routeKey(topic, subscriptionId));
      assembler.abort(topic, subscriptionId);
      scheduleExpiry();
    },
    discard(topic, subscriptionId) {
      faultedRoutes.delete(routeKey(topic, subscriptionId));
      assembler.discard(topic, subscriptionId);
      scheduleExpiry();
    },
    clear() {
      faultedRoutes.clear();
      assembler.clear();
      if (expiryTimer) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
    },
  };
}
