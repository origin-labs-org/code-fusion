import { z } from "zod";

export const executionPermissionModeSchema = z.enum(["build", "edit", "yolo", "guarded", "auto"]);
export const executionStateSchema = z.object({
  mode: executionPermissionModeSchema,
  planEnabled: z.boolean(),
});
export type ExecutionState = z.infer<typeof executionStateSchema>;

export function resolveExecutionState(
  input: { mode?: string; planEnabled?: boolean },
  current: ExecutionState = { mode: "build", planEnabled: false },
): ExecutionState {
  const mode = executionPermissionModeSchema.safeParse(input.mode);
  return {
    mode: mode.success ? mode.data : current.mode,
    planEnabled:
      input.planEnabled ??
      (input.mode === "plan" ? true : mode.success ? false : current.planEnabled),
  };
}
