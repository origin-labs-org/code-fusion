import { z } from "zod";
import { browserClientModeSchema } from "./commands.js";

export const browserBackendTypeSchema = z.enum(["iab", "extension", "cdp"]);
export type BrowserBackendType = z.infer<typeof browserBackendTypeSchema>;

export const browserCapabilityDescriptorSchema = z
  .object({
    id: z.string().trim().min(1),
    description: z.string().trim().min(1),
  })
  .strict();
export type BrowserCapabilityDescriptor = z.infer<typeof browserCapabilityDescriptorSchema>;

export const browserBackendDescriptorSchema = z
  .object({
    id: z.string().trim().min(1),
    
    generation: z.number().int().nonnegative().default(0),
    type: browserBackendTypeSchema,
    name: z.string().trim().min(1),
    capabilities: z
      .object({
        browser: z.array(browserCapabilityDescriptorSchema).optional(),
        tab: z.array(browserCapabilityDescriptorSchema).optional(),
      })
      .strict(),
    apiSupportOverrides: z.record(z.string(), z.boolean()).optional(),
    
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type BrowserBackendDescriptor = z.infer<typeof browserBackendDescriptorSchema>;

export const browserSessionContextKindSchema = z.enum(["live", "cached"]);
export type BrowserSessionContextKind = z.infer<typeof browserSessionContextKindSchema>;

export const browserDiscoveryContextSchema = z
  .object({
    requestId: z.string().trim().min(1),
    workspaceKey: z.string().trim().min(1),
    workspacePath: z.string().trim().min(1),
    workspaceIdentity: z.string().trim().min(1).optional(),
    remoteSessionId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1),
    turnId: z.string().trim().min(1).optional(),
    clientMode: browserClientModeSchema,
    sessionContext: browserSessionContextKindSchema,
  })
  .strict();
export type BrowserDiscoveryContext = z.infer<typeof browserDiscoveryContextSchema>;

export const browserSessionContextSchema = browserDiscoveryContextSchema
  .extend({
    browserId: z.string().trim().min(1),
    browserGeneration: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserSessionContext = z.infer<typeof browserSessionContextSchema>;

export const browserBackendListResultSchema = z
  .object({ browsers: z.array(browserBackendDescriptorSchema) })
  .strict();
export type BrowserBackendListResult = z.infer<typeof browserBackendListResultSchema>;
