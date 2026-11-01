import { RollingToolbarLabel } from "@/chat-input-toolbar/RollingToolbarLabel.js";
import { ControlShortcutBadge } from "@/ControlShortcutBadge.js";

export function ComposerEffortHeading({
  label,
  value,
  shortcut,
}: {
  label: string;
  value: string;
  shortcut?: string;
}) {
  return (
    <div className="mb-1 flex items-center gap-2 text-ui-base">
      <span className="text-ui-sm text-foreground-subtle">{label}</span>
      <span data-testid="composer-thought-value">
        <RollingToolbarLabel label={value} />
      </span>
      {}
      {shortcut ? (
        <ControlShortcutBadge className="ml-auto" data-testid="composer-effort-shortcut">
          {shortcut}
        </ControlShortcutBadge>
      ) : null}
    </div>
  );
}
