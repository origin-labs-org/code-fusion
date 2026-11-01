import { z } from "zod";

export const browserElementRectSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .strict();
export type BrowserElementRect = z.infer<typeof browserElementRectSchema>;

export const browserSnapshotElementSchema = z
  .object({
    ref: z.string().min(1),
    tag: z.string(),
    role: z.string().optional(),
    /** accessibleName */
    name: z.string().optional(),
    text: z.string().optional(),
    value: z.string().optional(),
    disabled: z.boolean().optional(),
    checked: z.boolean().optional(),
    selector: z.string(),
    xpath: z.string(),
    rect: browserElementRectSchema,
    inViewport: z.boolean(),
    
    parentRef: z.string().optional(),
    
    framePath: z.string().optional(),
    
    attributes: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type BrowserSnapshotElement = z.infer<typeof browserSnapshotElementSchema>;

export const browserSnapshotDomNodeSchema = z
  .object({
    tag: z.string(),
    depth: z.number().int().nonnegative(),
    inViewport: z.boolean(),
    ref: z.string().min(1).optional(),
    role: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    attributes: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type BrowserSnapshotDomNode = z.infer<typeof browserSnapshotDomNodeSchema>;

export const browserSnapshotSchema = z
  .object({
    url: z.string(),
    title: z.string(),
    
    dom: z.array(browserSnapshotDomNodeSchema).optional(),
    
    domTruncated: z.boolean().optional(),
    elements: z.array(browserSnapshotElementSchema),
    
    truncated: z.boolean(),
  })
  .strict();
export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>;
