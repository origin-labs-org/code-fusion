import { z } from "zod";
import { browserErrorCodeSchema, browserPageStateSchema } from "./commands.js";
import { browserViewportSizeSchema } from "./command-metadata.js";
import { browserBackendTypeSchema } from "./backend.js";
import { browserSnapshotSchema, browserSnapshotElementSchema } from "./snapshot.js";

export const browserTabSummarySchema = z
  .object({
    tabId: z.string(),
    url: z.string(),
    title: z.string(),
    
    viewport: browserViewportSizeSchema,
    
    active: z.boolean().optional(),
    lifecycle: z.enum(["active", "deliverable", "handoff"]).optional(),
  })
  .strict();
export type BrowserTabSummary = z.infer<typeof browserTabSummarySchema>;

export const browserUserTabInfoSchema = z
  .object({
    id: z.string().min(1),
    lastOpened: z.string().optional(),
    tabGroup: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
  })
  .strict();
export type BrowserUserTabInfo = z.infer<typeof browserUserTabInfoSchema>;

export const browserDialogSchema = z
  .object({
    type: z.enum(["alert", "confirm", "prompt", "beforeunload"]),
    message: z.string(),
    defaultPrompt: z.string().optional(),
  })
  .strict();
export type BrowserDialog = z.infer<typeof browserDialogSchema>;

export const browserResponseMetaSchema = z
  .object({
    browserUse: z.literal(true),
    backendType: browserBackendTypeSchema,
    browserId: z.string().min(1),
    browserGeneration: z.number().int().nonnegative(),
    openTabIds: z.array(z.string()),
    tabId: z.string().optional(),
    currentUrl: z.string().optional(),
    lifecycle: z.enum(["active", "deliverable", "handoff", "closed"]).optional(),
  })
  .strict();
export type BrowserResponseMeta = z.infer<typeof browserResponseMetaSchema>;

export const browserRecordingArtifactSchema = z
  .object({
    path: z.string().min(1),
    mimeType: z.literal("video/webm"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    durationMs: z.number().nonnegative(),
    frameCount: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserRecordingArtifact = z.infer<typeof browserRecordingArtifactSchema>;

export const browserRecordingJobSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["running", "completed", "failed", "cancelled"]),
    phase: z.enum(["preparing", "capturing", "finalizing", "completed", "failed", "cancelled"]),
    progress: z.number().min(0).max(1),
    startedAt: z.number().nonnegative(),
    updatedAt: z.number().nonnegative(),
    artifact: browserRecordingArtifactSchema.optional(),
    error: z.string().optional(),
  })
  .strict();
export type BrowserRecordingJob = z.infer<typeof browserRecordingJobSchema>;

export const browserCommandResultSchema = z
  .object({
    ok: z.boolean(),
    state: browserPageStateSchema.optional(),
    snapshot: browserSnapshotSchema.optional(),
    image: z
      .object({ base64: z.string(), mimeType: z.literal("image/png") })
      .strict()
      .optional(),
    
    tabs: z.array(browserTabSummarySchema).optional(),
    
    userTabs: z.array(browserUserTabInfoSchema).optional(),
    
    tab: browserTabSummarySchema.optional(),
    
    value: z.unknown().optional(),
    
    element: browserSnapshotElementSchema.optional(),
    
    dialog: browserDialogSchema.nullable().optional(),
    
    recording: browserRecordingJobSchema.optional(),
    error: z
      .object({
        code: browserErrorCodeSchema,
        message: z.string(),
        sideEffect: z.enum(["none", "uncertain"]).optional(),
      })
      .strict()
      .optional(),
    meta: browserResponseMetaSchema.optional(),
    elapsedMs: z.number().nonnegative(),
  })
  .strict();
export type BrowserCommandResult = z.infer<typeof browserCommandResultSchema>;
