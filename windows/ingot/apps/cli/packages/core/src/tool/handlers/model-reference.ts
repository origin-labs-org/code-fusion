// ============================================================
// ============================================================
//
//

import type { ModelCatalogEntry, ModelSelection } from "@origin-ai/cf-contracts";
import {
  CF_MODEL_REASONING_SEPARATOR,
  formatModelPickerValue,
  parseModelPickerValue,
} from "@origin-ai/cf-shared/model-selection";

type ModelReferenceResolution =
  | { ok: true; selection: ModelSelection; entry: ModelCatalogEntry; canonical: string }
  | {
      ok: false;
      reason: "not_found" | "ambiguous" | "other_provider" | "disabled" | "reasoning_level_unknown";
      message: string;
      candidates: ModelCatalogEntry[];
    };

const MODEL_REFERENCE_CANDIDATE_LINES = 40;

export function resolveModelReference(
  text: string,
  entries: ModelCatalogEntry[],
): ModelReferenceResolution {
  const { reference, level } = splitReasoningLevel(text.trim());
  const qualified = isQualifiedReference(reference);
  const matches = matchEntries(reference, qualified, entries);
  if (matches.length === 0) return notFoundResolution(text, entries);

  const enabled = matches.filter((entry) => entry.disabledReason === undefined);
  if (enabled.length === 0) return disabledResolution(text, matches);

  const sessionEntry = entries.find((entry) => entry.current);
  const guarded = !qualified && sessionEntry !== undefined;
  const home = guarded
    ? enabled.filter((entry) => sameToken(entry.providerId, sessionEntry.providerId))
    : enabled;
  if (guarded && home.length === 0) return otherProviderResolution(text, sessionEntry, enabled);

  const entry = home.length === 1 ? home[0]! : home.find((candidate) => candidate.current);
  if (entry === undefined) return ambiguousResolution(text, home);

  const options = resolveReasoningOptions(entry, level);
  if (options === undefined) {
    return reasoningLevelUnknownResolution(text, entry, level ?? "");
  }

  const selection: ModelSelection = {
    providerId: entry.providerId,
    modelId: entry.modelId,
    ...options,
  };
  return { ok: true, selection, entry, canonical: formatModelPickerValue(selection) };
}

export function parseWorkflowSubagentModel(canonical: string | undefined): ModelSelection | undefined {
  if (canonical === undefined) return undefined;
  try {
    return parseModelPickerValue(canonical);
  } catch (cause) {
    throw new Error(
      `workflow subagent_model reached the handler un-canonicalised: ${canonical}`,
      { cause },
    );
  }
}

export function describeWorkflowSubagentModel(canonical: string | undefined): string {
  if (canonical === undefined) return "";
  return ` Subagents run on ${canonical} (the main agent stays on the session model).`;
}

export function formatModelCatalogId(entry: ModelCatalogEntry): string {
  return `${entry.providerId}/${entry.modelId}`;
}

function splitReasoningLevel(text: string): { reference: string; level?: string } {
  const providerSeparatorIndex = text.indexOf("/");
  const searchFrom = providerSeparatorIndex + 1;
  const index = text.indexOf(CF_MODEL_REASONING_SEPARATOR, searchFrom);
  if (index <= searchFrom || index >= text.length - 1) return { reference: text };
  return { reference: text.slice(0, index), level: text.slice(index + 1) };
}

function isQualifiedReference(reference: string): boolean {
  return reference.indexOf("/") > 0;
}

function matchEntries(
  reference: string,
  qualified: boolean,
  entries: ModelCatalogEntry[],
): ModelCatalogEntry[] {
  if (qualified) {
    const providerSeparatorIndex = reference.indexOf("/");
    const providerId = reference.slice(0, providerSeparatorIndex);
    const modelId = reference.slice(providerSeparatorIndex + 1);
    return entries.filter(
      (entry) => sameToken(entry.providerId, providerId) && sameToken(entry.modelId, modelId),
    );
  }
  return entries.filter((entry) => sameToken(entry.modelId, reference));
}

function resolveReasoningOptions(
  entry: ModelCatalogEntry,
  level: string | undefined,
): { options?: { reasoningLevel: string } } | undefined {
  if (level !== undefined) {
    const matched = entry.reasoningLevels.find((candidate) => sameToken(candidate, level));
    return matched === undefined ? undefined : { options: { reasoningLevel: matched } };
  }
  if (entry.reasoningLevels.length === 0 || entry.defaultReasoningLevel === undefined) return {};
  return { options: { reasoningLevel: entry.defaultReasoningLevel } };
}

function notFoundResolution(text: string, entries: ModelCatalogEntry[]): ModelReferenceResolution {
  const candidates = entries.filter((entry) => entry.disabledReason === undefined);
  const shown = candidates.slice(0, MODEL_REFERENCE_CANDIDATE_LINES);
  const overflow = candidates.length - shown.length;
  const lines = shown.map(
    (entry) => `${formatModelCatalogId(entry)}${entry.current ? " [current]" : ""}`,
  );
  if (overflow > 0) lines.push(`… and ${overflow} more.`);
  const body =
    candidates.length === 0
      ? "No models are configured on this host."
      : ["Available models:", ...lines].join("\n");
  return {
    ok: false,
    reason: "not_found",
    message: `No configured model matches \`${text}\`. ${body}\n\nPass one of these ids, or call ListModels.`,
    candidates,
  };
}

function otherProviderResolution(
  text: string,
  sessionEntry: ModelCatalogEntry,
  candidates: ModelCatalogEntry[],
): ModelReferenceResolution {
  const lines = candidates.map((entry) => formatModelCatalogId(entry));
  const sessionProvider = sessionEntry.providerLabel ?? sessionEntry.providerId;
  return {
    ok: false,
    reason: "other_provider",
    message: `\`${text}\` is not configured under the session's provider (${sessionProvider}), only under:\n${lines.join("\n")}\n\nA bare model name never moves the subagents to another provider. Do not pick one on your own: if you think it would help, ask the user first; once they asked for that model, pass its full \`providerId/modelId\`.`,
    candidates,
  };
}

function ambiguousResolution(
  text: string,
  candidates: ModelCatalogEntry[],
): ModelReferenceResolution {
  const lines = candidates.map((entry) => formatModelCatalogId(entry));
  return {
    ok: false,
    reason: "ambiguous",
    message: `\`${text}\` is configured under more than one provider:\n${lines.join("\n")}\n\nPass the full \`providerId/modelId\` of the one you want.`,
    candidates,
  };
}

function disabledResolution(
  text: string,
  candidates: ModelCatalogEntry[],
): ModelReferenceResolution {
  const lines = candidates.map(
    (entry) => `${formatModelCatalogId(entry)} — ${entry.disabledReason}`,
  );
  return {
    ok: false,
    reason: "disabled",
    message: `\`${text}\` matches a model that cannot be used on this host:\n${lines.join("\n")}\n\nResolve that with the user, or call ListModels and pick another id.`,
    candidates,
  };
}

function reasoningLevelUnknownResolution(
  text: string,
  entry: ModelCatalogEntry,
  level: string,
): ModelReferenceResolution {
  const id = formatModelCatalogId(entry);
  const levels =
    entry.reasoningLevels.length === 0
      ? `${id} has no reasoning levels — drop the \`$\` suffix.`
      : `Its levels are: ${entry.reasoningLevels.join(", ")}.${
          entry.defaultReasoningLevel === undefined
            ? ""
            : ` Omit the suffix to use ${entry.defaultReasoningLevel}.`
        }`;
  return {
    ok: false,
    reason: "reasoning_level_unknown",
    message: `\`${level}\` is not a reasoning level of ${id}. ${levels}`,
    candidates: [entry],
  };
}

function sameToken(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
