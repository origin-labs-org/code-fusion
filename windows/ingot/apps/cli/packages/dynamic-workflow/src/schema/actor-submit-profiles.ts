import type { SiteGraph } from "../analysis/types.js";
import { interpret } from "../analysis/interpret.js";
import { projectSiteGraph } from "../analysis/graph.js";
import type { SiteTable } from "../analysis/sites.js";
import type { WorkflowProgram } from "../compiler/compile.js";
import type { AskSpec } from "../engine/types.js";
import { canonicalJson } from "../engine/hash.js";
import type { JsonSchema } from "./types.js";

export type ActorSubmitProfile =
  | { kind: "untyped" }
  | { kind: "mono"; schema: JsonSchema }
  | { kind: "generic" };

export const GENERIC_SUBMIT_PROFILE: ActorSubmitProfile = { kind: "generic" };

export function deriveActorSubmitProfiles(
  graph: SiteGraph,
  askSpecs: ReadonlyMap<string, AskSpec>,
): Map<string, ActorSubmitProfile> {
  const profiles = new Map<string, ActorSubmitProfile>();
  const actorIds = graph.actors.map((actor) => actor.id);

  const schemasByActor = new Map<string, Map<string, JsonSchema>>();
  for (const id of actorIds) schemasByActor.set(id, new Map());

  for (const node of graph.nodes) {
    if (node.kind !== "ask") continue;
    const actors = node.actors ?? [];
    const spec = askSpecs.get(node.id);
    if (actors.length === 0 || spec === undefined) {
      for (const id of actorIds) profiles.set(id, GENERIC_SUBMIT_PROFILE);
      return profiles;
    }
    if (!spec.typed) continue;
    const schema = spec.schema as JsonSchema;
    const key = canonicalJson(schema);
    for (const actorId of actors) {
      let bucket = schemasByActor.get(actorId);
      if (bucket === undefined) {
        bucket = new Map();
        schemasByActor.set(actorId, bucket);
      }
      bucket.set(key, schema);
    }
  }

  for (const [actorId, bucket] of schemasByActor) {
    if (bucket.size === 0) profiles.set(actorId, { kind: "untyped" });
    else if (bucket.size === 1)
      profiles.set(actorId, { kind: "mono", schema: [...bucket.values()][0]! });
    else profiles.set(actorId, GENERIC_SUBMIT_PROFILE);
  }
  return profiles;
}

export function deriveActorSubmitProfilesFor(
  workflow: WorkflowProgram,
  table: SiteTable,
  askSpecs: ReadonlyMap<string, AskSpec>,
): Map<string, ActorSubmitProfile> {
  return deriveActorSubmitProfiles(projectSiteGraph(interpret(workflow, table)), askSpecs);
}
