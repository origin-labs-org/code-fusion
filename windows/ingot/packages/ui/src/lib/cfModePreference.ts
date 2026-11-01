import type { CfConfigOption } from "@origin-ai/cf-shared";

export function applySelectedCfMode(
  options: readonly CfConfigOption[],
  mode: string,
): CfConfigOption[] {
  const normalizedMode = mode.trim();
  if (!normalizedMode) {
    return [...options];
  }

  let changed = false;
  const nextOptions = options.map((option) => {
    if (option.category !== "mode" || option.type !== "select") {
      return option;
    }

    const hasModeOption = Boolean(
      option.options?.some((candidate) => candidate.value === normalizedMode),
    );
    if (!hasModeOption || option.currentValue === normalizedMode) {
      return option;
    }

    changed = true;
    return {
      ...option,
      currentValue: normalizedMode,
    };
  });

  return changed ? nextOptions : [...options];
}
