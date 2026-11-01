import { z } from "zod";

export const submissionModeSchema = z.enum(["build", "edit", "plan", "yolo", "guarded"]);
export type SubmissionMode = z.infer<typeof submissionModeSchema>;
