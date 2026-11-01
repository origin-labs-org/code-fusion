const fallbackToastClaimsByCommandId = new Set<string>();
const cardInvalidationClaims = new Set<string>();

export function claimHighspeedFallbackToast(sourceCommandId: string): boolean {
  if (fallbackToastClaimsByCommandId.has(sourceCommandId)) return false;
  fallbackToastClaimsByCommandId.add(sourceCommandId);
  return true;
}

export function claimHighspeedCardInvalidation(sourceCommandId: string): boolean {
  if (cardInvalidationClaims.has(sourceCommandId)) return false;
  cardInvalidationClaims.add(sourceCommandId);
  return true;
}

export function releaseHighspeedCardInvalidation(sourceCommandId: string): void {
  cardInvalidationClaims.delete(sourceCommandId);
}
