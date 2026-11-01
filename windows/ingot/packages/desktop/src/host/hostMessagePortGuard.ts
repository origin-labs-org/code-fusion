import { hostIncomingMessageSchema } from "@origin-ai/cf-shared";

export interface CloseableTransferredPort {
  close(): void;
}

export interface HostIncomingMessageEventLike {
  data: unknown;
  ports: readonly CloseableTransferredPort[];
}

function closeTransferredPort(port: CloseableTransferredPort | undefined): void {
  try {
    port?.close();
  } catch {
  }
}

export function parseHostIncomingMessageEvent(
  event: HostIncomingMessageEventLike,
): ReturnType<typeof hostIncomingMessageSchema.safeParse> {
  const result = hostIncomingMessageSchema.safeParse(event.data);
  if (!result.success) {
    for (const port of event.ports) closeTransferredPort(port);
  }
  return result;
}

export function rejectUnavailableAttachedServicePort(
  port: CloseableTransferredPort,
  servicesReady: boolean,
): boolean {
  if (servicesReady) return false;
  closeTransferredPort(port);
  return true;
}
