import type { WorkModelReasoning } from "$shared/ipc/bindings";
import * as m from "$shared/i18n/messages";

const NAMES: Record<WorkModelReasoning, () => string> = {
  low: m.model_effort_low,
  medium: m.model_effort_medium,
  high: m.model_effort_high,
  xhigh: m.model_effort_xhigh,
  max: m.model_effort_max,
};

export function effortName(level: WorkModelReasoning): string {
  return NAMES[level]();
}
