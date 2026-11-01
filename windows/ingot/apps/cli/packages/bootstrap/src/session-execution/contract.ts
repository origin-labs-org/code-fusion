import type { CommandPayloadMap } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { SendInputOptions } from "../app/types.js";

export interface SessionResidencyFinalizationOwner {
  residencyFinalizationCount?: number;
}
export type ModelExecutionInput = NonNullable<CommandPayloadMap["sendText"]["modelExecution"]>;
export type ModelExecutionContext = NonNullable<SendInputOptions["modelExecution"]>;

export interface SessionExecutionContract {
  
  createModelExecutionContext(input: ModelExecutionInput): ModelExecutionContext;
  
  acquireSessionResidencyFinalization(owner: SessionResidencyFinalizationOwner): () => void;
  
  runWithSessionResidencyFinalization<T>(
    owner: SessionResidencyFinalizationOwner,
    run: () => Promise<T>,
  ): Promise<T>;
}
