interface SuccessfulPluginEnabledChangeOptions {
  submit: () => Promise<boolean>;
  isCurrent: () => boolean;
  onSuccess: () => void | Promise<void>;
}

export async function runAfterSuccessfulPluginEnabledChange({
  submit,
  isCurrent,
  onSuccess,
}: SuccessfulPluginEnabledChangeOptions): Promise<boolean> {
  const succeeded = await submit();
  if (!succeeded || !isCurrent()) {
    return false;
  }

  await onSuccess();
  return true;
}
