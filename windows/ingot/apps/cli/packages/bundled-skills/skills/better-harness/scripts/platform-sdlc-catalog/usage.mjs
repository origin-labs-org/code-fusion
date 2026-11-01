import { createAnalyzer } from "../session-analysis.mjs";
import { collectSkillUsageObservations } from "../session-analysis/daily-usage.mjs";

const DAY_MS = 86_400_000;
const DEFAULT_HISTORY = "30d";
const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 16;

function normalizedName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function increment(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

function dateLabel(value) {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ""));
  if (!Number.isFinite(time)) throw new Error(`invalid usage date: ${value}`);
  return new Date(time).toISOString().slice(0, 10);
}

function observedTimestamp(value) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null;
}

function markdownCell(value) {
  return String(value ?? "-").replaceAll("|", "\\|").replace(/\s+/gu, " ").trim() || "-";
}

function capabilityStageLabels(labels, capability) {
  return capability.stageRefs.map((stageId) => labels.get(stageId) ?? stageId);
}

function boundedConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.floor(parsed));
}

export function resolvePlatformSdlcUsageWindow(options = {}, now = new Date()) {
  const history = options.history ?? DEFAULT_HISTORY;
  if (!["30d", "all"].includes(history)) {
    throw new Error(`usage history must be 30d or all; received ${history}`);
  }
  const until = options.until ?? null;
  let since = options.since ?? null;
  if (!since && history === "30d") {
    const anchor = until ? new Date(`${dateLabel(until)}T00:00:00.000Z`) : new Date(now);
    since = dateLabel(new Date(anchor.getTime() - (30 * DAY_MS)));
  }
  return { history, since, until };
}

function commandObservations(catalog, events) {
  const commands = catalog.capabilities
    .filter((capability) => capability.kind === "command")
    .map((capability) => ({
      capability,
      pattern: new RegExp(`(?:^|[\\r\\n])\\s*${escapeRegex(capability.name)}(?=\\s|$)`, "iu"),
    }));
  const seen = new Set();
  const observations = [];
  for (const event of events) {
    if (!event?.userText) continue;
    for (const { capability, pattern } of commands) {
      if (!pattern.test(event.userText)) continue;
      const identity = [
        event.sessionId ?? "unknown",
        event.timestamp ?? "unknown",
        normalizedName(capability.name),
        event.userText,
      ].join(":");
      if (seen.has(identity)) continue;
      seen.add(identity);
      observations.push({ name: capability.name });
    }
  }
  return observations;
}

export function collectExplicitPlatformSdlcUsage(catalog, events = []) {
  const skillCounts = new Map();
  const commandCounts = new Map();
  for (const observation of collectSkillUsageObservations(events)) {
    increment(skillCounts, normalizedName(observation.name));
  }
  for (const observation of commandObservations(catalog, events)) {
    increment(commandCounts, normalizedName(observation.name));
  }
  return { skillCounts, commandCounts };
}

function mergeCounts(target, source) {
  for (const [name, count] of source) increment(target, name, count);
}

function usageRows(catalog, skillCounts, commandCounts) {
  const stageLabels = new Map(catalog.stages.map((stage) => [stage.id, stage.label]));
  return catalog.capabilities.map((capability) => {
    const name = normalizedName(capability.name);
    const activations = capability.kind === "skill"
      ? (skillCounts.get(name) ?? 0)
      : capability.kind === "command"
        ? (commandCounts.get(name) ?? 0)
        : 0;
    const observation = activations === 0
      ? "not-observed"
      : capability.kind === "command"
        ? "explicit-user-command"
        : "explicit-skill-name-match";
    return {
      id: capability.id,
      name: capability.name,
      kind: capability.kind,
      catalogAvailability: capability.availability,
      stageRefs: [...capability.stageRefs],
      stageLabels: capabilityStageLabels(stageLabels, capability),
      activations,
      observation,
    };
  });
}

function uncataloguedSkills(catalog, skillCounts) {
  const catalogued = new Set(
    catalog.capabilities
      .filter((capability) => capability.kind === "skill")
      .map((capability) => normalizedName(capability.name)),
  );
  return [...skillCounts.entries()]
    .filter(([name]) => !catalogued.has(name))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, activations]) => ({ name, activations }));
}

function stageMappings(catalog, capabilities) {
  return catalog.stages.map((stage) => {
    const matched = capabilities.filter((capability) =>
      capability.activations > 0 && capability.stageRefs.includes(stage.id));
    return {
      stageId: stage.id,
      label: stage.label,
      canonicalPhase: stage.canonicalPhase,
      matchedCapabilityCount: matched.length,
      matchedCapabilityIds: matched.map((capability) => capability.id),
      matchedCapabilityNames: matched.map((capability) => capability.name),
    };
  });
}

function sessionTimeBoundary(sessions) {
  let firstSeen = null;
  let lastSeen = null;
  let undatedSessionCount = 0;
  for (const session of sessions) {
    const timestamps = [observedTimestamp(session.firstSeen), observedTimestamp(session.lastSeen)].filter(Boolean);
    if (timestamps.length === 0) undatedSessionCount += 1;
    for (const timestamp of timestamps) {
      if (!firstSeen || timestamp < firstSeen) firstSeen = timestamp;
      if (!lastSeen || timestamp > lastSeen) lastSeen = timestamp;
    }
  }
  return {
    firstSeen,
    lastSeen,
    undatedSessionCount,
  };
}

export async function analyzePlatformSdlcUsage(catalog, options = {}, dependencies = {}) {
  const window = resolvePlatformSdlcUsageWindow(options, dependencies.now ?? new Date());
  const analyzer = dependencies.analyzer ?? await createAnalyzer(catalog.platformId);
  const analyzeOptions = {
    command: "sessions",
    workspace: options.workspace,
    home: options.home,
    since: window.since,
    until: window.until,
    includeGlobalCapabilities: options.allProjects === true,
  };
  const inventory = await analyzer.analyze(analyzeOptions);
  const scope = await analyzer.resolveScope(analyzeOptions);
  const skillCounts = new Map();
  const commandCounts = new Map();
  const concurrency = boundedConcurrency(options.concurrency);

  for (let index = 0; index < inventory.sessions.length; index += concurrency) {
    const batch = inventory.sessions.slice(index, index + concurrency);
    const eventGroups = await Promise.all(batch.map((session) => analyzer.readSession(session, scope, {
      includeUserText: true,
      includeCommandText: false,
      includeContent: false,
    })));
    for (const events of eventGroups) {
      const usage = collectExplicitPlatformSdlcUsage(catalog, events);
      mergeCounts(skillCounts, usage.skillCounts);
      mergeCounts(commandCounts, usage.commandCounts);
    }
  }

  const capabilities = usageRows(catalog, skillCounts, commandCounts);
  const uncataloguedObservedSkills = uncataloguedSkills(catalog, skillCounts);
  const observedCapabilities = capabilities.filter((capability) => capability.activations > 0);
  return {
    kind: "better-harness.platform-sdlc-usage",
    schemaVersion: 1,
    platformId: catalog.platformId,
    displayName: catalog.displayName,
    catalog: {
      datasetPath: catalog.datasetPath,
      sourceCompleteness: catalog.sourceCompleteness,
      sourceGaps: [...catalog.sourceGaps],
      capabilityCount: catalog.capabilities.length,
    },
    scope: {
      history: window.history,
      since: scope.since,
      until: scope.until,
      allProjects: scope.includeGlobalCapabilities,
      workspace: scope.workspace,
    },
    sessions: {
      eligibleCount: inventory.sessions.length,
      ...sessionTimeBoundary(inventory.sessions),
    },
    capabilities,
    stageMappings: stageMappings(catalog, capabilities),
    uncataloguedObservedSkills,
    summary: {
      observedCatalogCapabilityCount: observedCapabilities.length,
      observedCatalogSkillCount: observedCapabilities.filter((capability) => capability.kind === "skill").length,
      observedCatalogCommandCount: observedCapabilities.filter((capability) => capability.kind === "command").length,
      explicitCatalogActivationCount: observedCapabilities.reduce((sum, capability) => sum + capability.activations, 0),
      uncataloguedObservedSkillCount: uncataloguedObservedSkills.length,
      uncataloguedExplicitActivationCount: uncataloguedObservedSkills.reduce((sum, skill) => sum + skill.activations, 0),
    },
    warnings: inventory.warnings.map((warning) => ({ code: warning.code, source: warning.source ?? null })),
    evidenceBoundary: {
      availability: "catalog-snapshot-only",
      skillUse: "explicit-Skill-invocation-name-match",
      commandUse: "explicit-user-message-line-start",
      actor: "Skill-invocation-does-not-prove-deliberate-user-selection",
      provenance: "invocation-name-does-not-identify-built-in-versus-configured-owner",
      stageMapping: "catalog-mapping-does-not-prove-task-stage-at-activation-time",
      effectiveness: "not-evaluated",
    },
  };
}

export function renderPlatformSdlcUsageMarkdown(report) {
  const lines = [
    `# ${report.displayName} SDLC Capability Usage`,
    "",
    `- History: ${report.scope.history}${report.scope.since ? ` (since ${report.scope.since})` : " (all retained history)"}`,
    `- Project scope: ${report.scope.allProjects ? `all ${report.displayName} projects` : "current workspace"}`,
    `- Eligible sessions: ${report.sessions.eligibleCount}`,
    `- Observed range: ${report.sessions.firstSeen ?? "unknown"} to ${report.sessions.lastSeen ?? "unknown"}`,
    `- Undated sessions: ${report.sessions.undatedSessionCount}`,
    "",
    "| Capability | Kind | Catalog availability | SDLC stages | Explicit activations | Observation |",
    "| --- | --- | --- | --- | ---: | --- |",
  ];
  for (const capability of report.capabilities) {
    lines.push(`| \`${markdownCell(capability.name)}\` | ${markdownCell(capability.kind)} | ${markdownCell(capability.catalogAvailability)} | ${markdownCell(capability.stageLabels.join(", "))} | ${capability.activations} | ${markdownCell(capability.observation)} |`);
  }

  lines.push("", "## Observed Skills outside this catalog", "");
  if (report.uncataloguedObservedSkills.length === 0) lines.push("No uncatalogued explicit Skill invocations were observed.");
  else {
    lines.push("| Skill name | Explicit activations |", "| --- | ---: |");
    for (const skill of report.uncataloguedObservedSkills) {
      lines.push(`| \`${markdownCell(skill.name)}\` | ${skill.activations} |`);
    }
  }

  lines.push(
    "",
    "Catalog availability, explicit use, actor, provenance, and effectiveness are separate evidence. A Skill invocation proves session use, not deliberate user selection; a name match does not prove whether the built-in or a configured Skill owned it. Not observed does not prove never used when retained sources are partial.",
    "",
  );
  return lines.join("\n");
}
