
export const ALL_KINDS = ["docx", "xlsx", "pptx", "pdf"] as const;
export type DocKind = (typeof ALL_KINDS)[number];
