import type { ICodingPlanSubscriptionService } from "@origin-ai/cf-services";
import type { RequestVerificationProof } from "@origin-ai/cf-shared";
export function useRequestVerificationPrewarm(_visible: boolean): void {}
export async function prepareRequestVerificationClaim(
  _service: ICodingPlanSubscriptionService,
  signal: AbortSignal,
  _onVerifying: () => void,
): Promise<RequestVerificationProof | undefined> {
  signal.throwIfAborted();
  return {};
}
