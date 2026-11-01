import type { ModelRequestObservation } from "@origin-ai/cf-contracts/model";
import type { RequestObservationTarget } from "../request-observation-target.js";
export function recordRequestObservation(
  _writer: RequestObservationTarget,
  _observation: ModelRequestObservation,
): void {}
