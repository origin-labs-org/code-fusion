
export function shouldApplyOAuthPollingFailure(
  loginSucceeded: boolean,
  loginSuccessInFlight = false,
): boolean {
  return !loginSucceeded && !loginSuccessInFlight;
}
