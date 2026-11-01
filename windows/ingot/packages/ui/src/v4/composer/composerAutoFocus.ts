
export type ComposerAutoFocusDecision = "focus-now" | "defer" | "skip";

export interface ComposerAutoFocusOptions {
  
  autoFocusEnabled: boolean;
  
  disabled: boolean;
  
  isMobileViewport: boolean;
}

export function resolveComposerAutoFocus({
  autoFocusEnabled,
  disabled,
  isMobileViewport,
}: ComposerAutoFocusOptions): ComposerAutoFocusDecision {
  if (!autoFocusEnabled || isMobileViewport) return "skip";
  if (disabled) return "defer";
  return "focus-now";
}
