import { z } from "zod";

export const attachmentSourceKindSchema = z.enum(["clipboard-text", "topic-history"]);
export type AttachmentSourceKind = z.infer<typeof attachmentSourceKindSchema>;
