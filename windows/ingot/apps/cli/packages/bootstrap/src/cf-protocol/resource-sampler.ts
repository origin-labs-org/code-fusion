import type { Logger } from "@origin-ai/cf-contracts";
import {
  createMemorySampleWriteGate,
  memoryUsageToSampleFields,
  cfProtocolNotifications,
  type MemorySample,
  type CfProtocolNotification,
} from "@origin-ai/cf-shared";
import {
  createCfProcessResourceSampler,
  type CfProcessResourceSampler,
} from "../process-resource-sampler.js";
import type { CfProtocolAgentServer } from "./server.js";

export function startProtocolResourceSampler(
  server: CfProtocolAgentServer,
  send: (message: CfProtocolNotification) => void,
  logger: Logger,
): CfProcessResourceSampler | undefined {
  try {
    const memoryDiagnosticsGate = createMemorySampleWriteGate();
    const sampler = createCfProcessResourceSampler({
      onSample: (sample, memoryUsage) => {
        send({
          method: cfProtocolNotifications.processResourceSample,
          params: sample,
        });
        server.rebalanceResidentSessions();
        try {
          server.pruneSessionEventStores();
          server.pruneDetachedChildPublishers();
        } catch {
        }
        try {
          const memorySample: MemorySample = {
            role: "agent_node",
            ...memoryUsageToSampleFields(memoryUsage),
            counters: server.collectMemoryDiagnostics(),
          };
          const reason = memoryDiagnosticsGate.evaluate(memorySample, Date.now());
          if (reason) {
            const { role: _role, counters, ...memoryFields } = memorySample;
            logger.info("Process memory sample", {
              event: "cf_protocol.process.memory_sample",
              reason,
              ...memoryFields,
              counters,
            });
          }
        } catch {
        }
      },
    });
    sampler.start();
    return sampler;
  } catch {
    return undefined;
  }
}
