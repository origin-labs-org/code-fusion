import type { CommandAck, CommandEnvelope } from "@origin-ai/cf-shared/cf-protocol-v4";
import { logger } from "@/logger.js";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import { pendingCommandRegistry } from "@/v4/pendingCommandRegistry.js";

type SendCommand = (envelope: CommandEnvelope) => Promise<CommandAck>;

export async function sendInteractionAutoResolutionSnooze(params: {
  sessionId: string;
  interactionId: string;
  sendCommand: SendCommand;
  source: "dialog" | "taskBadge";
  onCommandSettled?: (commandId: string) => void;
}): Promise<boolean> {
  const envelope = createCommandEnvelope({
    type: "snoozeInteractionAutoResolution",
    sessionId: params.sessionId,
    payload: { interactionId: params.interactionId },
  });
  pendingCommandRegistry.record(envelope);
  try {
    const ack = await params.sendCommand(envelope);
    pendingCommandRegistry.applyAck(envelope, ack);
    if (ack.status === "accepted" || ack.status === "duplicate" || ack.status === "noop") {
      return true;
    }
    logger.warn("[v4-interaction] Pausing auto-termination was rejected", {
      interactionId: params.interactionId,
      source: params.source,
      status: ack.status,
      reasonCode: ack.reasonCode,
    });
    return false;
  } catch (error) {
    logger.error("[v4-interaction] Failed to pause auto-termination", {
      interactionId: params.interactionId,
      source: params.source,
      error,
    });
    return false;
  } finally {
    params.onCommandSettled?.(envelope.commandId);
  }
}
