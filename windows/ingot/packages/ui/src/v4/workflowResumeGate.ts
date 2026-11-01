
export function resolveWorkflowResumeHandler<THandler>(options: {
  readOnly: boolean | undefined;
  
  dynamicWorkflowEnabled: boolean;
  handler: THandler;
}): THandler | undefined {
  if (options.readOnly === true) return undefined;
  if (!options.dynamicWorkflowEnabled) return undefined;
  return options.handler;
}
