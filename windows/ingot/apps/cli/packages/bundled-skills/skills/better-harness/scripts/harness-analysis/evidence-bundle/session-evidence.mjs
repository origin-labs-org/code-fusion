import { createAnalyzer } from "../../session-analysis.mjs";
import { availableLane } from "./contract.mjs";

export async function collectSessionEvidence(context, options = {}, dependencies = {}) {
  const create = dependencies.createAnalyzer ?? createAnalyzer;
  const analyzer = await create(context.provider);
  const data = await analyzer.analyze({
    command: "facts",
    workspace: context.workspace,
    platform: context.provider,
    selection: "all-eligible",
    since: context.window.since,
    until: context.window.until,
    limit: context.evidenceLimit,
    "episode-limit": context.evidenceLimit,
    ...(options[`${context.provider}-home`] ? { [`${context.provider}-home`]: options[`${context.provider}-home`] } : {}),
  });
  if (data?.kind !== "session-core-facts" || !Array.isArray(data.candidates)) {
    throw Object.assign(new Error("session facts returned an invalid contract"), {
      code: "INVALID_SESSION_EVIDENCE",
    });
  }
  return availableLane(data);
}
