import { z } from "zod";
import {
  conversationShareContentBlockSchema,
  SHARE_CONTENT_LIMITS,
} from "./conversation-share-content.js";

import type { Locale } from "./protocol.js";
import {
  conversationArtifactTypeSchema,
  conversationRowSchema,
  type ConversationRow,
} from "./cf-protocol-v4/rows.js";

const CONVERSATION_SHARE_LOCALE_PATH_PREFIX: Readonly<Record<Locale, string>> = {
  "zh-CN": "/cn",
  "en-US": "",
};

const CONVERSATION_SHARE_PATHNAME_RE = /^\/(cn\/)?share\/([^/]+)\/?$/u;

export function parseConversationSharePathname(
  pathname: string,
): { rawCode: string; locale: Locale } | null {
  const match = CONVERSATION_SHARE_PATHNAME_RE.exec(pathname);
  if (!match) return null;
  return { rawCode: match[2]!, locale: match[1] ? "zh-CN" : "en-US" };
}

export function localizeConversationShareUrl(shareUrl: string, locale: Locale): string {
  let url: URL;
  try {
    url = new URL(shareUrl);
  } catch {
    return shareUrl;
  }
  const parsed = parseConversationSharePathname(url.pathname);
  if (!parsed) return shareUrl;
  url.pathname = `${CONVERSATION_SHARE_LOCALE_PATH_PREFIX[locale]}/share/${parsed.rawCode}`;
  return url.toString();
}

export const conversationShareAccessModeSchema = z.enum([
  "private",
  "public_readonly",
  "public_importable",
]);
export type ConversationShareAccessMode = z.infer<typeof conversationShareAccessModeSchema>;

export const CONVERSATION_SHARE_SCHEMA_VERSION = 1;

const conversationShareSchemaVersionSchema = z.number().int().positive();

export function isConversationShareSchemaVersionSupported(version: number): boolean {
  return version <= CONVERSATION_SHARE_SCHEMA_VERSION;
}

export function decodeConversationShareRows(rows: readonly unknown[]): {
  rows: ConversationRow[];
  unsupportedCount: number;
  unsupportedKinds: string[];
} {
  const decoded: ConversationRow[] = [];
  const unsupportedKinds: string[] = [];
  let unsupportedCount = 0;
  for (const row of rows) {
    const parsed = conversationRowSchema.safeParse(row);
    if (parsed.success) {
      decoded.push(parsed.data);
      continue;
    }
    unsupportedCount += 1;
    const kind = (row as { kind?: unknown } | null)?.kind;
    const label = typeof kind === "string" && kind.trim() ? kind.trim() : "unknown";
    if (!unsupportedKinds.includes(label)) unsupportedKinds.push(label);
  }
  return { rows: decoded, unsupportedCount, unsupportedKinds };
}

export const conversationShareSha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

const conversationShareArtifactDescriptorFields = {
  artifact_id: z.string().trim().min(1),
  logical_artifact_key: z.string().trim().min(1),
  producer_product_turn_id: z.string().trim().min(1),
  artifact_version: z.number().int().positive(),
  state: z.literal("current"),
  ref: z.string().regex(/^cf-artifact:\/\/share\/[A-Za-z0-9._~-]+$/u),
  artifact_type: conversationArtifactTypeSchema,
  display_name: z.string().trim().min(1),
  original_path: z.string().min(1).optional(),
  extension: z.string().trim().min(1),
  mime_type: z.string().trim().min(1),
  size_bytes: z.number().int().nonnegative(),
  sha256: conversationShareSha256Schema,
} as const;

export const conversationShareArtifactDescriptorSchema = z
  .object(conversationShareArtifactDescriptorFields)
  .strict();
export type ConversationShareArtifactDescriptor = z.infer<
  typeof conversationShareArtifactDescriptorSchema
>;

export const conversationShareInboundArtifactDescriptorSchema = z.object(
  conversationShareArtifactDescriptorFields,
);

const conversationShareAllowedArtifactShapeSchema = z.object({
  type: z.string().trim().min(1),
  extensions: z.array(z.string().trim().min(1)),
  mime_types: z.array(z.string().trim().min(1)),
});

const conversationShareCapabilitiesBaseFields = {
  content_block_versions: z.record(z.string(), z.number().int().positive()).optional(),
  ttl_ms: z.number().int().positive(),
  max_rows: z.number().int().positive(),
  max_payload_bytes: z.number().int().positive(),
  max_artifact_count: z.number().int().nonnegative(),
  max_artifact_bytes: z.number().int().positive(),
  max_total_artifact_bytes: z.number().int().positive(),
};

export const conversationShareCapabilitiesWireSchema = z.object({
  ...conversationShareCapabilitiesBaseFields,
  schema_version: conversationShareSchemaVersionSchema,
  access_modes: z.array(z.string().trim().min(1)),
  allowed_artifacts: z.array(conversationShareAllowedArtifactShapeSchema),
});
export type ConversationShareCapabilitiesWire = z.infer<
  typeof conversationShareCapabilitiesWireSchema
>;

export const conversationShareCapabilitiesDataSchema = z
  .object({
    ...conversationShareCapabilitiesBaseFields,
    schema_version: conversationShareSchemaVersionSchema,
    access_modes: z.array(conversationShareAccessModeSchema),
    allowed_artifacts: z.array(
      z
        .object({
          type: conversationArtifactTypeSchema,
          extensions: z.array(z.string().trim().min(1)),
          mime_types: z.array(z.string().trim().min(1)),
        })
        .strict(),
    ),
  })
  .strict();
export type ConversationShareCapabilities = z.infer<typeof conversationShareCapabilitiesDataSchema>;

export function narrowConversationShareCapabilities(wire: ConversationShareCapabilitiesWire): {
  capabilities: ConversationShareCapabilities;
  unsupportedArtifactTypes: string[];
  unsupportedAccessModes: string[];
} {
  const supported: ConversationShareCapabilities["allowed_artifacts"] = [];
  const unsupportedArtifactTypes: string[] = [];
  for (const entry of wire.allowed_artifacts) {
    const type = conversationArtifactTypeSchema.safeParse(entry.type);
    if (type.success) supported.push({ ...entry, type: type.data });
    else if (!unsupportedArtifactTypes.includes(entry.type))
      unsupportedArtifactTypes.push(entry.type);
  }
  const accessModes: ConversationShareAccessMode[] = [];
  const unsupportedAccessModes: string[] = [];
  for (const mode of wire.access_modes) {
    const parsed = conversationShareAccessModeSchema.safeParse(mode);
    if (parsed.success) accessModes.push(parsed.data);
    else if (!unsupportedAccessModes.includes(mode)) unsupportedAccessModes.push(mode);
  }
  return {
    capabilities: { ...wire, access_modes: accessModes, allowed_artifacts: supported },
    unsupportedArtifactTypes,
    unsupportedAccessModes,
  };
}

export const conversationShareConfirmDataSchema = z.object({
  share_code: z.string().trim().min(1),
  share_url: z.string().url(),
  access_mode: conversationShareAccessModeSchema,
  expires_at: z.number().int().nonnegative(),
});
export type ConversationShareRecord = z.infer<typeof conversationShareConfirmDataSchema>;

export const conversationSharePreparationRequestSchema = z
  .object({
    client_request_id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    schema_version: z.literal(CONVERSATION_SHARE_SCHEMA_VERSION),
    access_mode: conversationShareAccessModeSchema,
    payload_sha256: conversationShareSha256Schema,
    artifact_count: z.number().int().nonnegative(),
  })
  .strict();
export type ConversationSharePreparationRequest = z.infer<
  typeof conversationSharePreparationRequestSchema
>;

const conversationSharePreparationBaseFields = {
  preparation_id: z.string().trim().min(1),
  access_mode: conversationShareAccessModeSchema,
  expires_at: z.number().int().nonnegative(),
} as const;

export const conversationSharePreparationDataSchema = z.discriminatedUnion("status", [
  z.object({
    ...conversationSharePreparationBaseFields,
    status: z.literal("preparing"),
  }),
  z.object({
    ...conversationSharePreparationBaseFields,
    status: z.literal("confirmed"),
    share: conversationShareConfirmDataSchema,
  }),
]);
export type ConversationSharePreparation = z.infer<typeof conversationSharePreparationDataSchema>;

export const conversationShareArtifactUploadDataSchema = z.object({
  artifact_id: z.string().trim().min(1),
  size_bytes: z.number().int().nonnegative(),
  sha256: conversationShareSha256Schema,
  status: z.literal("uploaded"),
  safety_status: z.string().trim().min(1),
});
export type ConversationShareArtifactUpload = z.infer<
  typeof conversationShareArtifactUploadDataSchema
>;

const conversationShareIntegrityFields = {
  content_blocks_sha256: conversationShareSha256Schema.optional(),
  projection_sha256: conversationShareSha256Schema,
  artifact_set_sha256: conversationShareSha256Schema,
} as const;

export const conversationShareIntegritySchema = z.object(conversationShareIntegrityFields);
export type ConversationShareIntegrity = z.infer<typeof conversationShareIntegritySchema>;

const conversationShareOutboundIntegritySchema = z
  .object(conversationShareIntegrityFields)
  .strict();

export const conversationShareConfirmRequestSchema = z
  .object({
    selected_product_turn_ids: z.array(z.string().trim().min(1)).min(1),
    projection: z
      .object({
        rows: z.array(conversationRowSchema).min(1),
        content_blocks: z
          .array(conversationShareContentBlockSchema)
          .min(1)
          .max(SHARE_CONTENT_LIMITS.blocks)
          .optional(),
      })
      .strict(),
    integrity: conversationShareOutboundIntegritySchema,
    disclosure_confirmation: z
      .object({
        version: z.literal(1),
        accepted_at: z.number().int().nonnegative(),
        acknowledged_no_secret_detection: z.literal(true),
      })
      .strict(),
  })
  .strict();
export type ConversationShareConfirmRequest = z.infer<typeof conversationShareConfirmRequestSchema>;

const conversationSharePublicMetadataSchema = z.object({
  title: z.string(),
  access_mode: conversationShareAccessModeSchema,
  created_at: z.number().int().nonnegative(),
  expires_at: z.number().int().nonnegative(),
});

export const conversationSharePreviewArtifactSchema =
  conversationShareInboundArtifactDescriptorSchema.extend({
    url: z
      .string()
      .url()
      .refine((url) => /^https?:\/\//iu.test(url)),
    url_expires_at: z.number().int().nonnegative(),
  });

export const conversationSharePreviewDataSchema = z.object({
  schema_version: conversationShareSchemaVersionSchema,
  share: conversationSharePublicMetadataSchema,
  rows: z.array(z.unknown()),
  content_blocks: z.array(z.unknown()).optional(),
  artifacts: z.array(conversationSharePreviewArtifactSchema),
  integrity: conversationShareIntegritySchema,
});
export type ConversationSharePreviewWire = z.infer<typeof conversationSharePreviewDataSchema>;
export type ConversationSharePreview = Omit<ConversationSharePreviewWire, "rows"> & {
  rows: ConversationRow[];
  
  unsupportedRowCount: number;
};

export const conversationShareContinuationRequestSchema = z
  .object({
    schema_version: z.literal(CONVERSATION_SHARE_SCHEMA_VERSION),
    client_request_id: z.string().trim().min(1),
  })
  .strict();
export type ConversationShareContinuationRequest = z.infer<
  typeof conversationShareContinuationRequestSchema
>;

export const conversationShareContinuationArtifactSchema =
  conversationShareInboundArtifactDescriptorSchema.extend({
    download_url: conversationSharePreviewArtifactSchema.shape.url,
    download_url_expires_at: z.number().int().nonnegative(),
  });

export const conversationShareContinuationDataSchema = z.object({
  schema_version: conversationShareSchemaVersionSchema,
  import_grant_id: z.string().trim().min(1),
  import_grant_expires_at: z.number().int().nonnegative(),
  share: conversationSharePublicMetadataSchema.extend({
    share_id: z.string().trim().min(1),
  }),
  rows: z.array(z.unknown()),
  content_blocks: z.array(z.unknown()).optional(),
  artifacts: z.array(conversationShareContinuationArtifactSchema),
  integrity: conversationShareIntegritySchema,
});
export type ConversationShareContinuationWire = z.infer<
  typeof conversationShareContinuationDataSchema
>;
export type ConversationShareContinuation = Omit<ConversationShareContinuationWire, "rows"> & {
  rows: ConversationRow[];
  
  rawRows: readonly unknown[];
  
  unsupportedRowCount: number;
};

export const conversationShareKnownErrorCodeSchema = z.union([
  z.literal(3001),
  z.literal(3002),
  z.literal(3200),
  z.literal(3201),
  z.literal(3203),
  z.literal(3204),
  z.literal(3205),
  z.literal(3206),
  z.literal(3207),
  z.literal(3208),
  z.literal(3209),
  z.literal(3210),
  z.literal(3211),
  z.literal(3212),
  z.literal(3213),
  z.literal(3214),
  z.literal(3215),
  z.literal(3216),
  z.literal(3217),
]);
export type ConversationShareApiErrorCode = z.infer<typeof conversationShareKnownErrorCodeSchema>;

const SHARE_ERROR_KIND_BY_CODE = {
  3001: "invalid_contract",
  3002: "rate_limited",
  3200: "feature_disabled",
  3201: "authentication_required",
  3203: "unsupported_schema_version",
  3204: "invalid_contract",
  3205: "invalid_conversation",
  3206: "disclosure_required",
  3207: "unsafe_structure",
  3208: "artifact_not_allowed",
  3209: "limit_exceeded",
  3210: "upload_incomplete",
  3211: "not_found",
  3212: "expired",
  3213: "authentication_required",
  3214: "import_not_allowed",
  3215: "safety_check_pending",
  3216: "safety_check_rejected",
  3217: "safety_check_unavailable",
} as const satisfies Record<ConversationShareApiErrorCode, string>;

export type ConversationShareErrorKind =
  | (typeof SHARE_ERROR_KIND_BY_CODE)[ConversationShareApiErrorCode]
  | "service_unavailable"
  | "network"
  | "unknown";

export function classifyConversationShareError(
  status: number,
  code?: number,
): ConversationShareErrorKind {
  const known = conversationShareKnownErrorCodeSchema.safeParse(code);
  if (known.success) return SHARE_ERROR_KIND_BY_CODE[known.data];
  if (status === 401) return "authentication_required";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "service_unavailable";
  if (status === 403 || status === 404) return "not_found";
  if (status === 410) return "expired";
  if (status === 413) return "limit_exceeded";
  return status >= 200 && status < 300 && code === undefined ? "invalid_contract" : "unknown";
}

const rejectionCoordinateSchema = z
  .string()
  .min(1)
  .max(65)
  .regex(/^[A-Za-z0-9_.[\]~-]+$/u);
export const conversationShareRejectionSchema = z.object({
  rule: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/u),
  path: rejectionCoordinateSchema.optional().catch(undefined),
  field: rejectionCoordinateSchema.optional().catch(undefined),
  row_index: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().catch(undefined),
  row_kind: rejectionCoordinateSchema.optional().catch(undefined),
});
export type ConversationShareRejection = z.infer<typeof conversationShareRejectionSchema>;

export const conversationShareRequestIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/u);

export const conversationShareErrorEnvelopeSchema = z.object({
  code: z.number().int(),
  msg: z.string(),
  logid: conversationShareRequestIdSchema.optional().catch(undefined),
  data: conversationShareRejectionSchema.optional().catch(undefined),
});
export type ConversationShareErrorEnvelope = z.infer<typeof conversationShareErrorEnvelopeSchema>;

export function createConversationShareSuccessEnvelopeSchema<TSchema extends z.ZodType>(
  dataSchema: TSchema,
) {
  return z.object({
    code: z.literal(0),
    msg: z.string(),
    data: dataSchema,
  });
}
