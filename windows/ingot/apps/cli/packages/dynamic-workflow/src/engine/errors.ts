

import type { Violation } from "../schema/types.js";
import type { ProviderStopDetails } from "./run-terminal.js";

export type WorkflowErrorCode =
  | "ValidationFailed"
  | "ResultNotSubmitted"
  | "DriverError"
  | "WorldReadCapExceeded"
  | "Cancelled"
  | "ContextLimit"
  | "ReportCapExceeded"
  | "InputHashMismatch"
  | "UnknownActor"
  | "MissingAskSpec"
  | "DuplicateActorName"
  | "ScriptHashMismatch"
  | "Interrupted"
  | "ProviderStop"
  //
  | "ArtifactSourceMissing"
  | "ArtifactPathOutsideWorkspace"
  | "ArtifactTooLarge"
  | "ArtifactStoreUnavailable"
  | "ArtifactVersionCapExceeded"
  | "ArtifactKindMismatch"
  | "ArtifactCapExceeded"
  | "ArtifactSpecInvalid"
  | "ArtifactRedeclared"
  | "ArtifactUndeclared"
  | "ArtifactPrimaryConflict";

export interface WorkflowErrorMismatch {
  expected: string;
  got: string;
}

export interface WorkflowErrorJson {
  code: WorkflowErrorCode;
  message: string;
  violations?: Violation[];
  finalText?: string;
  mismatch?: WorkflowErrorMismatch;
  
  providerStop?: ProviderStopDetails;
}

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  readonly violations?: Violation[];
  readonly finalText?: string;
  readonly mismatch?: WorkflowErrorMismatch;
  readonly providerStop?: ProviderStopDetails;

  constructor(
    code: WorkflowErrorCode,
    message: string,
    extra?: {
      violations?: Violation[];
      finalText?: string;
      mismatch?: WorkflowErrorMismatch;
      providerStop?: ProviderStopDetails;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    if (extra?.violations !== undefined) this.violations = extra.violations;
    if (extra?.finalText !== undefined) this.finalText = extra.finalText;
    if (extra?.mismatch !== undefined) this.mismatch = extra.mismatch;
    if (extra?.providerStop !== undefined) this.providerStop = extra.providerStop;
    if (extra?.cause !== undefined) (this as { cause?: unknown }).cause = extra.cause;
  }

  
  toJSON(): WorkflowErrorJson {
    const json: WorkflowErrorJson = { code: this.code, message: this.message };
    if (this.violations !== undefined) json.violations = this.violations;
    if (this.finalText !== undefined) json.finalText = this.finalText;
    if (this.mismatch !== undefined) json.mismatch = this.mismatch;
    if (this.providerStop !== undefined) json.providerStop = this.providerStop;
    return json;
  }

  
  static fromJSON(json: WorkflowErrorJson): WorkflowError {
    return new WorkflowError(json.code, json.message, {
      violations: json.violations,
      finalText: json.finalText,
      mismatch: json.mismatch,
      providerStop: json.providerStop,
    });
  }
}
