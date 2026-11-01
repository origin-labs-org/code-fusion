export { WorkSession, workSession } from "./work.svelte";
export type {
  WorkRuntimeProjection,
  WorkArtifactV1,
  WorkArtifactDataV1,
  WorkExecutionFact,
  WorkSignalV1,
  WorkEvidenceLink,
} from "$shared/ipc/bindings";
export { commandId, sameProjection, validRevision, AGENT_GRANT, AGENT_LIMITS } from "./work-model";

export { currentActivity } from "./work-activity";
