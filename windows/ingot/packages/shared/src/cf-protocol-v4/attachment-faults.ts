//
//

export const CF_ATTACHMENT_FAULT_CODES = {
  
  statUnsupported: "fault.attachment.statUnsupported",
  
  readUnsupported: "fault.attachment.readUnsupported",
  
  statNotFile: "fault.attachment.statNotFile",
  
  shareStatNotAuthorized: "fault.attachment.shareStatNotAuthorized",
  
  shareReadNotAuthorized: "fault.attachment.shareReadNotAuthorized",
  
  shareStatConnectionUntrusted: "fault.attachment.shareStatConnectionUntrusted",
  
  shareReadConnectionUntrusted: "fault.attachment.shareReadConnectionUntrusted",
  
  shareStatNotFound: "fault.attachment.shareStatNotFound",
  
  shareStatTooLarge: "fault.attachment.shareStatTooLarge",
  
  previewTooLarge: "fault.attachment.previewTooLarge",
  
  previewNotMedia: "fault.attachment.previewNotMedia",
} as const;

export type CfAttachmentFaultCode =
  (typeof CF_ATTACHMENT_FAULT_CODES)[keyof typeof CF_ATTACHMENT_FAULT_CODES];

const KNOWN_FAULT_CODES = new Set<string>(Object.values(CF_ATTACHMENT_FAULT_CODES));

export function isCfAttachmentFaultCode(value: unknown): value is CfAttachmentFaultCode {
  return typeof value === "string" && KNOWN_FAULT_CODES.has(value);
}

export class CfAttachmentFaultError extends Error {
  readonly code: CfAttachmentFaultCode;

  constructor(code: CfAttachmentFaultCode, options?: { cause?: unknown; message?: string }) {
    super(
      options?.message ?? code,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "CfAttachmentFaultError";
    this.code = code;
  }
}

export function readCfAttachmentFaultCode(error: unknown): CfAttachmentFaultCode | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; data?: unknown };
  if (isCfAttachmentFaultCode(candidate.code)) return candidate.code;
  if (candidate.data && typeof candidate.data === "object") {
    const data = candidate.data as { code?: unknown };
    if (isCfAttachmentFaultCode(data.code)) return data.code;
  }
  if (error instanceof Error && isCfAttachmentFaultCode(error.message)) return error.message;
  return undefined;
}
