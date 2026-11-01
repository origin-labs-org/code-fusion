
export function createGroupDeliveryThrottle() {
  const nextSendAt = new Map<string, number>();
  return async (chatKey: string): Promise<void> => {
    const now = Date.now();
    const at = Math.max(now, nextSendAt.get(chatKey) ?? now);
    nextSendAt.set(chatKey, at + 250);
    if (at > now) await new Promise<void>((resolve) => setTimeout(resolve, at - now));
    if ((nextSendAt.get(chatKey) ?? 0) <= Date.now()) nextSendAt.delete(chatKey);
  };
}
