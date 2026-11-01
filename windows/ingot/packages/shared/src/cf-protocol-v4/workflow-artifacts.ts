// ============================================================
// ============================================================
//
//

import { z } from "zod";

import { PROTOCOL_V4_LIMITS } from "./core.js";

export const workflowRunArtifactKindSchema = z.enum([
  "file",
  "markdown",
  "chart",
  "table",
  "metrics",
  "board",
]);
export type WorkflowRunArtifactKind = z.infer<typeof workflowRunArtifactKindSchema>;

export const WORKFLOW_ARTIFACT_LIMITS = {
  maxIdLength: 64,
  maxTitleLength: 120,
  maxDescriptionLength: 500,
  
  maxVersions: 16,
  
  maxItemsPerPage: 500,
  
  defaultItemsPerPage: 200,
  
  maxPageBytes: PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxBytes / 4,
  
  maxFieldsPerRequest: 32,
  
  maxFieldPathLength: 256,
  
  maxFieldValueBytes: 4096,
} as const;

export function readWorkflowArtifactField(item: unknown, path: string): unknown {
  let cursor: unknown = item;
  for (const segment of path.split(".")) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return undefined;
      cursor = cursor[index];
      continue;
    }
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

export const workflowRunArtifactVersionSchema = z
  .object({
    version: z.number().int().positive().max(WORKFLOW_ARTIFACT_LIMITS.maxVersions),
    title: z.string().min(1).max(WORKFLOW_ARTIFACT_LIMITS.maxTitleLength).optional(),
    description: z.string().min(1).max(WORKFLOW_ARTIFACT_LIMITS.maxDescriptionLength).optional(),
    contentType: z.string().min(1).max(128).optional(),
    
    bytes: z.number().int().nonnegative().optional(),
    
    uri: z.string().min(1).max(512).optional(),
    
    sourcePath: z.string().min(1).max(1024).optional(),
    
    spec: z.unknown().optional(),
    
    publishedAt: z.number().int().nonnegative(),
    
    primary: z.literal(true).optional(),
  })
  .strict();
export type WorkflowRunArtifactVersion = z.infer<typeof workflowRunArtifactVersionSchema>;

export const workflowRunArtifactSchema = z
  .object({
    id: z.string().min(1).max(WORKFLOW_ARTIFACT_LIMITS.maxIdLength),
    kind: workflowRunArtifactKindSchema,
    title: z.string().min(1).max(WORKFLOW_ARTIFACT_LIMITS.maxTitleLength).optional(),
    description: z.string().min(1).max(WORKFLOW_ARTIFACT_LIMITS.maxDescriptionLength).optional(),
    contentType: z.string().min(1).max(128).optional(),
    sourcePath: z.string().min(1).max(1024).optional(),
    spec: z.unknown().optional(),
    
    version: z.number().int().positive().max(WORKFLOW_ARTIFACT_LIMITS.maxVersions),
    
    versions: z.array(workflowRunArtifactVersionSchema).max(WORKFLOW_ARTIFACT_LIMITS.maxVersions),
    
    itemCount: z.number().int().nonnegative(),
    
    primary: z.literal(true).optional(),
  })
  .strict();
export type WorkflowRunArtifact = z.infer<typeof workflowRunArtifactSchema>;

export const workflowRunArtifactSummarySchema = z
  .object({
    id: z.string().min(1).max(WORKFLOW_ARTIFACT_LIMITS.maxIdLength),
    kind: workflowRunArtifactKindSchema,
    title: z.string().min(1).max(WORKFLOW_ARTIFACT_LIMITS.maxTitleLength).optional(),
    version: z.number().int().positive().max(WORKFLOW_ARTIFACT_LIMITS.maxVersions),
    contentType: z.string().min(1).max(128).optional(),
    bytes: z.number().int().nonnegative().optional(),
    itemCount: z.number().int().nonnegative().optional(),
    
    primary: z.literal(true).optional(),
  })
  .strict();
export type WorkflowRunArtifactSummary = z.infer<typeof workflowRunArtifactSummarySchema>;

export const v4ConversationWorkflowRunArtifactsParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
  })
  .strict();
export type V4ConversationWorkflowRunArtifactsParams = z.infer<
  typeof v4ConversationWorkflowRunArtifactsParamsSchema
>;

export const v4ConversationWorkflowRunArtifactsResultSchema = z
  .object({
    
    artifacts: z.array(workflowRunArtifactSchema),
  })
  .strict();
export type V4ConversationWorkflowRunArtifactsResult = z.infer<
  typeof v4ConversationWorkflowRunArtifactsResultSchema
>;

export const v4ConversationWorkflowRunArtifactDataParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    artifactId: z.string().min(1).max(WORKFLOW_ARTIFACT_LIMITS.maxIdLength),
    
    afterSequence: z.number().int().nonnegative().optional(),
    
    limit: z.number().int().positive().max(WORKFLOW_ARTIFACT_LIMITS.maxItemsPerPage).optional(),
    
    fields: z
      .array(z.string().min(1).max(WORKFLOW_ARTIFACT_LIMITS.maxFieldPathLength))
      .min(1)
      .max(WORKFLOW_ARTIFACT_LIMITS.maxFieldsPerRequest)
      .optional(),
  })
  .strict();
export type V4ConversationWorkflowRunArtifactDataParams = z.infer<
  typeof v4ConversationWorkflowRunArtifactDataParamsSchema
>;

export const v4ConversationWorkflowRunArtifactDataResultSchema = z
  .object({
    items: z.array(
      z
        .object({
          
          sequence: z.number().int().nonnegative(),
          
          siteId: z.string().min(1).max(64),
          ordinal: z.number().int().nonnegative(),
          
          item: z.unknown(),
          
          fields: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    ),
    
    hasMore: z.boolean(),
  })
  .strict();
export type V4ConversationWorkflowRunArtifactDataResult = z.infer<
  typeof v4ConversationWorkflowRunArtifactDataResultSchema
>;

//
export const v4ConversationWorkflowRunArtifactReadParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    artifactId: z.string().min(1).max(WORKFLOW_ARTIFACT_LIMITS.maxIdLength),
    version: z.number().int().positive().max(WORKFLOW_ARTIFACT_LIMITS.maxVersions),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(PROTOCOL_V4_LIMITS.attachmentChunkMaxBytes),
  })
  .strict();
export type V4ConversationWorkflowRunArtifactReadParams = z.infer<
  typeof v4ConversationWorkflowRunArtifactReadParamsSchema
>;

export const v4ConversationWorkflowRunArtifactReadResultSchema = z
  .object({
    
    dataBase64: z.string(),
    
    mediaType: z.string().min(1).max(128),
    
    totalBytes: z.number().int().nonnegative().max(PROTOCOL_V4_LIMITS.attachmentMaxBytes),
    
    nextOffset: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const decodedBytes = decodedBase64ByteLength(value.dataBase64);
    if (decodedBytes === null) {
      context.addIssue({ code: "custom", message: "invalid base64", path: ["dataBase64"] });
      return;
    }
    if (decodedBytes > PROTOCOL_V4_LIMITS.attachmentChunkMaxBytes) {
      context.addIssue({
        code: "too_big",
        maximum: PROTOCOL_V4_LIMITS.attachmentChunkMaxBytes,
        origin: "string",
        inclusive: true,
        message: "workflow artifact read chunk exceeds decoded byte limit",
        path: ["dataBase64"],
      });
    }
    if (value.nextOffset !== null && value.nextOffset > value.totalBytes) {
      context.addIssue({
        code: "custom",
        message: "nextOffset exceeds totalBytes",
        path: ["nextOffset"],
      });
    }
  });
export type V4ConversationWorkflowRunArtifactReadResult = z.infer<
  typeof v4ConversationWorkflowRunArtifactReadResultSchema
>;

function decodedBase64ByteLength(value: string): number | null {
  if (value.length === 0) return 0;
  if (value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}
