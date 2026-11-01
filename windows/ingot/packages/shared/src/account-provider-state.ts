import { z } from "zod";

export const accountProviderUnavailableReasonSchema = z.enum([
  "not-authenticated",
  "not-connected",
  "credential-failed",
  "not-entitled",
]);
export type AccountProviderUnavailableReason = z.infer<
  typeof accountProviderUnavailableReasonSchema
>;
