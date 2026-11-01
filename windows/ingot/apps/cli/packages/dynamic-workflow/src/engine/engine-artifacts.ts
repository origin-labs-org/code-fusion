

import { canonicalJson, inputHash } from "./hash.js";
import { ARTIFACT_CAPS } from "../facade/artifact-caps.js";
import {
  isArtifactPresetOp,
  type ArtifactContentOp,
  type ArtifactPresetOp,
} from "../facade/registry.js";
import { heldResolution } from "./replay-order.js";
import {
  primaryArtifactId,
  primaryConflict,
  primaryConflictMessage,
} from "./engine-artifacts-primary.js";
import { validateArtifactSpec } from "./artifact-spec.js";
import { hashMismatch } from "./hash-mismatch.js";
import type { EngineState } from "./engine-state.js";
import type {
  ArtifactPublishRequest,
  ArtifactRef,
  ArtifactVersionRecord,
  InstanceRef,
} from "./types.js";
import { refToString, WorkflowError } from "./types.js";

export function publishContentArtifact(
  state: EngineState,
  siteId: string,
  op: ArtifactContentOp,
  args: unknown[],
): Promise<ArtifactRef> {
  if (state.isRunSettled()) return Promise.reject(state.runError());
  const ordinal = state.nextOrdinal(siteId);
  const instance: InstanceRef = { siteId, ordinal };

  const id = args[0];
  const payload = args[1];
  //
  if (typeof id !== "string" || id === "") {
    return Promise.reject(
      new WorkflowError(
        "DriverError",
        `artifact.${op}: id must be a non-empty string (at ${refToString(instance)}).`,
      ),
    );
  }
  if (typeof payload !== "string") {
    return Promise.reject(
      new WorkflowError(
        "DriverError",
        op === "file"
          ? `artifact.file: path must be a string (at ${refToString(instance)}).`
          : `artifact.markdown: content must be a string (at ${refToString(instance)}).`,
      ),
    );
  }
  const primaryOption = (args[2] as { primary?: unknown } | undefined)?.primary;
  if (primaryOption !== undefined && typeof primaryOption !== "boolean") {
    return Promise.reject(
      new WorkflowError(
        "DriverError",
        `artifact.${op}: opts.primary must be a boolean (at ${refToString(instance)}).`,
      ),
    );
  }
  const hash = inputHash({ args, id, op });

  const recorded = state.journal.getNode(state.runId, siteId, ordinal);
  if (recorded !== undefined) {
    if (recorded.inputHash !== hash) {
      const err = hashMismatch(instance, recorded.inputHash, hash);
      state.failRun(err);
      return Promise.reject(err);
    }
    if (recorded.status === "completed") {
      const record = recorded.result as ArtifactVersionRecord;
      return heldResolution(state.holdForReplay, instance, () => ({
        id: record.id,
        version: record.version,
      }));
    }
    if (recorded.status === "failed") {
      return heldResolution(state.holdForReplay, instance, () => {
        throw WorkflowError.fromJSON(recorded.error!);
      });
    }
  }

  const idState = state.artifacts.get(id);
  const primary = primaryOption === true || idState?.primary === true;
  const admission = admitArtifact(state, id, op, primary);
  if (admission !== undefined) {
    return Promise.reject(settleArtifactFailure(state, instance, hash, { id, op }, admission));
  }

  const version = (idState?.versions ?? 0) + 1;
  const publish = state.driver.executeArtifactPublish;
  if (publish === undefined) {
    return Promise.reject(
      settleArtifactFailure(
        state,
        instance,
        hash,
        { id, op },
        new WorkflowError(
          "ArtifactStoreUnavailable",
          `Cannot publish "${id}": this host has no artifact store (at ${refToString(instance)}).`,
        ),
      ),
    );
  }

  state.journal.putNode({
    runId: state.runId,
    siteId,
    ordinal,
    kind: "artifact",
    inputHash: hash,
    status: "running",
    artifactId: id,
  });

  const request: ArtifactPublishRequest = {
    runId: state.runId,
    siteId,
    ordinal,
    op,
    id,
    version,
    ...(op === "file" ? { path: payload } : { content: payload }),
    ...(args[2] === undefined ? {} : { opts: args[2] }),
  };
  return publish.call(state.driver, request).then(
    (record) => settleArtifactPublish(state, instance, hash, { id, op, version, primary }, record),
    (cause: unknown) => {
      const err =
        cause instanceof WorkflowError
          ? cause
          : new WorkflowError("DriverError", `Artifact publish failed: ${op} "${id}".`, {
              cause,
            });
      throw settleArtifactFailure(state, instance, hash, { id, op }, err);
    },
  );
}

export function declarePresetArtifact(
  state: EngineState,
  siteId: string,
  op: ArtifactPresetOp,
  args: unknown[],
): void {
  if (state.isRunSettled()) return;
  const ordinal = state.nextOrdinal(siteId);
  const instance: InstanceRef = { siteId, ordinal };

  const id = args[0];
  if (typeof id !== "string" || id === "") {
    state.failRun(
      new WorkflowError(
        "DriverError",
        `artifact.${op}: id must be a non-empty string (at ${refToString(instance)}).`,
      ),
    );
    return;
  }
  const spec = args[1];
  const hash = inputHash({ args, id, op });

  const recorded = state.journal.getNode(state.runId, siteId, ordinal);
  if (recorded !== undefined) {
    if (recorded.inputHash !== hash) {
      state.failRun(hashMismatch(instance, recorded.inputHash, hash));
      return;
    }
    return;
  }

  const problem = validateArtifactSpec(op, spec);
  if (problem !== undefined) {
    state.failRun(
      new WorkflowError(
        "ArtifactSpecInvalid",
        `Artifact "${id}" has an invalid spec (at ${refToString(instance)}): ${problem}`,
      ),
    );
    return;
  }

  const canonical = canonicalJson(spec);
  const idState = state.artifacts.get(id);
  if (idState !== undefined) {
    if (idState.kind !== op) {
      state.failRun(
        new WorkflowError(
          "ArtifactKindMismatch",
          `Artifact id "${id}" is already a ${idState.kind} and cannot be declared as a ${op} ` +
            `(at ${refToString(instance)}). An id belongs to one artifact kind for the whole run; ` +
            `use a different id.`,
        ),
      );
      return;
    }
    if (idState.spec === canonical) return;
    state.failRun(
      new WorkflowError(
        "ArtifactRedeclared",
        `Artifact "${id}" was already declared with a different spec (at ${refToString(instance)}). ` +
          `The spec for one id must stay identical (an identical re-declaration is a no-op); ` +
          `declare it once at the top of the script.`,
      ),
    );
    return;
  }
  const wantsPrimary = (spec as { primary?: unknown }).primary === true;
  const holder = wantsPrimary ? primaryArtifactId(state) : undefined;
  if (holder !== undefined && holder !== id) {
    state.failRun(
      new WorkflowError(
        "ArtifactPrimaryConflict",
        primaryConflictMessage(id, holder, `declare "${id}" without primary`, instance),
      ),
    );
    return;
  }
  if (state.artifacts.size >= ARTIFACT_CAPS.maxArtifactsPerRun) {
    state.failRun(
      new WorkflowError(
        "ArtifactCapExceeded",
        `Cannot declare "${id}": this run already has ${ARTIFACT_CAPS.maxArtifactsPerRun} artifact ` +
          `ids, the maximum. Reuse an existing id or publish fewer artifacts.`,
      ),
    );
    return;
  }

  const record = presetRecord(id, op, spec);
  state.artifacts.set(id, {
    kind: op,
    spec: canonical,
    versions: 1,
    ...(wantsPrimary ? { primary: true as const } : {}),
  });
  state.journal.putNode({
    runId: state.runId,
    siteId,
    ordinal,
    kind: "artifact",
    inputHash: hash,
    status: "completed",
    result: record,
    artifactId: id,
  });
  state.record({ type: "artifact-published", instance, artifact: record });
}

function admitArtifact(
  state: EngineState,
  id: string,
  op: ArtifactContentOp,
  primary: boolean,
): WorkflowError | undefined {
  const idState = state.artifacts.get(id);
  if (idState !== undefined && idState.kind !== op) {
    return new WorkflowError(
      "ArtifactKindMismatch",
      `Artifact id "${id}" is already a ${idState.kind} and cannot be published as a ${op}. An id ` +
        `belongs to one artifact kind for the whole run (publishing the same id again creates a ` +
        `new version, and a version cannot change what it is); use a different id.`,
    );
  }
  const holder = primaryConflict(state, id, primary);
  if (holder !== undefined) {
    return new WorkflowError(
      "ArtifactPrimaryConflict",
      primaryConflictMessage(id, holder, `publish "${id}" without primary`, undefined),
    );
  }
  if (idState === undefined && state.artifacts.size >= ARTIFACT_CAPS.maxArtifactsPerRun) {
    return new WorkflowError(
      "ArtifactCapExceeded",
      `Cannot publish "${id}": this run already has ${ARTIFACT_CAPS.maxArtifactsPerRun} artifact ` +
        `ids, the maximum. Publish a new version of an existing id instead.`,
    );
  }
  if (idState !== undefined && idState.versions >= ARTIFACT_CAPS.maxVersionsPerArtifact) {
    return new WorkflowError(
      "ArtifactVersionCapExceeded",
      `Artifact "${id}" already has ${idState.versions} versions, the maximum of ` +
        `${ARTIFACT_CAPS.maxVersionsPerArtifact}. Publish the final content in fewer versions.`,
    );
  }
  return undefined;
}

function settleArtifactPublish(
  state: EngineState,
  instance: InstanceRef,
  hash: string,
  issued: { id: string; op: ArtifactContentOp; version: number; primary: boolean },
  record: ArtifactVersionRecord,
): ArtifactRef {
  if (state.isRunSettled()) throw state.runError();
  const holder = primaryConflict(state, issued.id, issued.primary);
  if (holder !== undefined) {
    throw settleArtifactFailure(
      state,
      instance,
      hash,
      issued,
      new WorkflowError(
        "ArtifactPrimaryConflict",
        primaryConflictMessage(issued.id, holder, `publish "${issued.id}" without primary`, instance),
      ),
    );
  }
  const stored: ArtifactVersionRecord = issued.primary ? { ...record, primary: true } : record;
  state.journal.putNode({
    runId: state.runId,
    siteId: instance.siteId,
    ordinal: instance.ordinal,
    kind: "artifact",
    inputHash: hash,
    status: "completed",
    result: stored,
    artifactId: issued.id,
  });
  state.artifacts.set(issued.id, {
    kind: issued.op,
    versions: issued.version,
    ...(issued.primary ? { primary: true as const } : {}),
  });
  state.record({ type: "artifact-published", instance, artifact: stored });
  return { id: issued.id, version: issued.version };
}

function settleArtifactFailure(
  state: EngineState,
  instance: InstanceRef,
  hash: string,
  issued: { id: string; op: ArtifactContentOp },
  error: WorkflowError,
): WorkflowError {
  const json = error.toJSON();
  state.journal.putNode({
    runId: state.runId,
    siteId: instance.siteId,
    ordinal: instance.ordinal,
    kind: "artifact",
    inputHash: hash,
    status: "failed",
    error: json,
    artifactId: issued.id,
  });
  state.record({
    type: "artifact-failed",
    instance,
    id: issued.id,
    op: issued.op,
    error: json,
  });
  return error;
}

export function rememberArtifactRow(
  state: EngineState,
  id: string | undefined,
  result: unknown,
): void {
  if (id === undefined || id === "") return;
  const record = (result ?? undefined) as ArtifactVersionRecord | undefined;
  if (record?.kind === undefined) return;
  const existing = state.artifacts.get(id);
  const spec = record.spec === undefined ? existing?.spec : canonicalJson(record.spec);
  const primary = record.primary === true || existing?.primary === true;
  state.artifacts.set(id, {
    kind: record.kind,
    ...(spec === undefined ? {} : { spec }),
    versions: (existing?.versions ?? 0) + 1,
    ...(primary ? { primary: true as const } : {}),
  });
}

export function isDeclaredPreset(state: EngineState, id: string): boolean {
  const idState = state.artifacts.get(id);
  return idState !== undefined && isArtifactPresetOp(idState.kind);
}

export function declaredPresetIds(state: EngineState): string[] {
  return [...state.artifacts.entries()]
    .filter(([, idState]) => isArtifactPresetOp(idState.kind))
    .map(([id]) => id)
    .sort();
}

function presetRecord(id: string, op: ArtifactPresetOp, spec: unknown): ArtifactVersionRecord {
  const options = (spec ?? {}) as { title?: unknown; description?: unknown; primary?: unknown };
  return {
    id,
    kind: op,
    version: 1,
    ...(typeof options.title === "string" ? { title: options.title } : {}),
    ...(typeof options.description === "string" ? { description: options.description } : {}),
    spec,
    ...(options.primary === true ? { primary: true as const } : {}),
  };
}
