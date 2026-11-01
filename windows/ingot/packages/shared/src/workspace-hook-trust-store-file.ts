import { z } from "zod";

export const WORKSPACE_HOOK_TRUST_STORE_SCHEMA_VERSION = 1 as const;

const workspaceHookEventNameSchema = z.enum([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
]);

const nonEmptyStringSchema = z.string().trim().min(1);
const sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const nonnegativeIntegerSchema = z.number().int().nonnegative();

export const workspaceHookTrustRecordSchema = z
  .object({
    workspaceIdentity: nonEmptyStringSchema,
    hookDeclarationDigest: sha256DigestSchema,
    digestAlgorithm: z.literal("sha256"),
    decision: z.literal("trusted"),
    grantedAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().optional(),
    bundleDigestAtGrant: sha256DigestSchema.optional(),
    eventAtGrant: workspaceHookEventNameSchema,
    displayCommandAtGrant: nonEmptyStringSchema,
    sourcePathAtGrant: nonEmptyStringSchema,
    sourceDiscoveryOrderAtGrant: nonnegativeIntegerSchema.optional(),
    matcherAtGrant: z.string().nullable().optional(),
    matcherIndexAtGrant: nonnegativeIntegerSchema.optional(),
    hookIndexAtGrant: nonnegativeIntegerSchema.optional(),
    appVersionAtGrant: nonEmptyStringSchema.optional(),
  })
  .strict();
export type WorkspaceHookTrustRecord = z.infer<typeof workspaceHookTrustRecordSchema>;

export const workspaceHookTrustStoreFileSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_HOOK_TRUST_STORE_SCHEMA_VERSION),
    records: z.array(workspaceHookTrustRecordSchema),
  })
  .strict()
  .superRefine((store, context) => {
    const keys = store.records.map(
      (record) => `${record.workspaceIdentity}\u0000${record.hookDeclarationDigest}`,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["records"],
        message: "workspace identity and declaration digest keys must be unique",
      });
    }
  });
export type WorkspaceHookTrustStoreFile = z.infer<typeof workspaceHookTrustStoreFileSchema>;

export type WorkspaceHookTrustStoreParseResult =
  | { status: "ok"; file: WorkspaceHookTrustStoreFile }
  | { status: "invalid" };

export function parseWorkspaceHookTrustStoreContent(
  content: string,
): WorkspaceHookTrustStoreParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return { status: "invalid" };
  }
  const result = workspaceHookTrustStoreFileSchema.safeParse(parsed);
  if (!result.success) return { status: "invalid" };
  return { status: "ok", file: result.data };
}
