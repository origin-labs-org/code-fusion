export function runContextPanelActionWithClose({
  action,
  close,
}: {
  action?: () => void;
  close: () => void;
}) {
  close();
  action?.();
}
