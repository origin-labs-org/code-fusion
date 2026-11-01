import type { CodingPlanStatus } from "./constants.js";

export interface CodingPlanStatusPanelViewState {
  displayStatus: CodingPlanStatus;
  actionStatus: CodingPlanStatus;
  balanceStatus: CodingPlanStatus;
  loginLoading: boolean;
}

export function resolveCodingPlanStatusPanelViewState({
  status,
  loginPending,
}: {
  status: CodingPlanStatus;
  loginPending: boolean;
}): CodingPlanStatusPanelViewState {
  if (!loginPending) {
    return buildStableCodingPlanStatusPanelViewState(status, false);
  }

  if (status === "purchased" || status === "notPurchased") {
    return buildStableCodingPlanStatusPanelViewState(status, true);
  }

  return {
    displayStatus: "checking",
    actionStatus: status,
    balanceStatus: status,
    loginLoading: true,
  };
}

function buildStableCodingPlanStatusPanelViewState(
  status: CodingPlanStatus,
  loginLoading: boolean,
): CodingPlanStatusPanelViewState {
  return {
    displayStatus: status,
    actionStatus: status,
    balanceStatus: status,
    loginLoading,
  };
}
