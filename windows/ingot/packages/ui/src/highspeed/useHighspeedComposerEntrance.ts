import { useEffect, useState } from "react";

export type HighspeedComposerEntrance = "activation" | "restore";

function resolveEntrance(
  cardId: string | null,
  activationCardId: string | null,
): HighspeedComposerEntrance {
  return cardId !== null && cardId === activationCardId ? "activation" : "restore";
}

export function useHighspeedComposerEntrance({
  cardId,
  activationCardId,
  onActivationApplied,
}: {
  cardId: string | null;
  activationCardId: string | null;
  onActivationApplied?: (cardId: string) => void;
}): HighspeedComposerEntrance {
  const [latch, setLatch] = useState(() => ({
    cardId,
    entrance: resolveEntrance(cardId, activationCardId),
  }));
  let current = latch;
  if (latch.cardId !== cardId) {
    current = { cardId, entrance: resolveEntrance(cardId, activationCardId) };
    setLatch(current);
  }
  const appliedActivationCardId = current.entrance === "activation" ? current.cardId : null;
  useEffect(() => {
    if (appliedActivationCardId !== null) onActivationApplied?.(appliedActivationCardId);
  }, [appliedActivationCardId, onActivationApplied]);
  return current.entrance;
}
