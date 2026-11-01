import type {
  ConversationRow,
  TurnHeaderRow,
  UserInputRow,
  WorkflowLaunchMeta,
} from "@origin-ai/cf-shared/cf-protocol-v4";

export function resolveWorkflowLaunchMeta(
  header: TurnHeaderRow | undefined,
  userInputs: readonly UserInputRow[],
): WorkflowLaunchMeta | undefined {
  if (header?.origin !== "workflowLaunch") return undefined;
  return (
    header.workflowLaunch ??
    userInputs.find((row) => row.workflowLaunch !== undefined)?.workflowLaunch
  );
}

export function isWorkflowLaunchUserInputRow(row: ConversationRow): boolean {
  return row.kind === "userInput" && row.origin === "workflowLaunch";
}
