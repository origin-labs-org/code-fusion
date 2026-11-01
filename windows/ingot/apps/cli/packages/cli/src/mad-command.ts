import type { Logger } from "@origin-ai/cf-contracts";
import type { GlobalOptions, RunContext } from "@origin-ai/cf-shared-types";
import {
  GodRuntime,
  MAD_DECOMPOSITION,
  type Judgment,
  type MadClaim,
  type MadMode,
  type MadRunSnapshot,
  claimId,
  credentialId,
  instanceId,
  modelId,
  providerId,
  taskId,
} from "@origin-ai/cf-god-runtime";
import { apply as applyInvariants } from "@origin-ai/cf-invariants";
import { Context } from "@deepseek-ai/cordis";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MAD_COMMAND_USAGE =
  "Usage: cf mad <status|run|list|show|claim|discuss|resolve|arbiter|complete|cancel|finalize>\n" +
  "  cf mad status                      Runtime capabilities and the latest run\n" +
  "  cf mad run <task...> [--mode PLAN|BUILD|DEBUG] --models a,b [--max-agents N]\n" +
  "                                     Decompose, route and persist a run\n" +
  "  cf mad list                        Run ids, newest first\n" +
  "  cf mad show [runId]                Print a run snapshot\n" +
  "  cf mad discuss <text...> [--kind claim|hypothesis|question|evidence|counterargument]\n" +
  "  cf mad claim <text...> --evidence h1,h2 [--author a]\n" +
  "  cf mad resolve <claimId> --accept|--reject\n" +
  "  cf mad arbiter <a> <b> [--evidence a=h1,h2 --evidence b=h3]\n" +
  "  cf mad complete <taskId> --ok|--fail\n" +
  "  cf mad cancel <reason...>\n" +
  "  cf mad finalize                    Emit the final report and persist it";

const DEFAULT_BUDGET = { concurrency: 4, timeMs: 30 * 60_000 } as const;

/** Pretty-print a payload for `--json` output. Local so the command has no core dependency. */
function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface MadCommandDependencies {
  cwd?: () => string;
  logger?: Logger;
  /** Override the run root (defaults to `<cwd>/.cf/mad`). */
  runRoot?: string;
}

type Flags = Record<string, string[]>;

function parseArgs(args: readonly string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [rawName, inlineValue] = splitFlag(arg);
    const values = flags[rawName] ?? [];
    if (inlineValue !== undefined) {
      values.push(inlineValue);
    } else {
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values.push(next);
        index += 1;
      } else {
        values.push("true");
      }
    }
    flags[rawName] = values;
  }
  return { positionals, flags };
}

function splitFlag(arg: string): [string, string | undefined] {
  const withoutPrefix = arg.slice(2);
  const equals = withoutPrefix.indexOf("=");
  if (equals === -1) return [withoutPrefix, undefined];
  return [withoutPrefix.slice(0, equals), withoutPrefix.slice(equals + 1)];
}

function flagValue(flags: Flags, name: string): string | undefined {
  return flags[name]?.[0];
}

function flagList(flags: Flags, name: string): string[] {
  return (flags[name] ?? []).flatMap((value) => value.split(",")).map((v) => v.trim()).filter(Boolean);
}

function madRoot(deps: MadCommandDependencies): string {
  if (deps.runRoot) return deps.runRoot;
  return join((deps.cwd ?? process.cwd)(), ".cf", "mad");
}

function runsDir(deps: MadCommandDependencies): string {
  return join(madRoot(deps), "runs");
}

async function writeRun(deps: MadCommandDependencies, snapshot: MadRunSnapshot): Promise<string> {
  const directory = runsDir(deps);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${snapshot.runId}.json`);
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await writeFile(join(madRoot(deps), "latest.json"), `${JSON.stringify({ runId: snapshot.runId }, null, 2)}\n`, "utf8");
  return path;
}

async function readLatestRunId(deps: MadCommandDependencies): Promise<string | undefined> {
  try {
    const raw = await readFile(join(madRoot(deps), "latest.json"), "utf8");
    const parsed = JSON.parse(raw) as { runId?: string };
    return parsed.runId;
  } catch {
    return undefined;
  }
}

async function readRun(
  deps: MadCommandDependencies,
  runId?: string,
): Promise<MadRunSnapshot | undefined> {
  const id = runId ?? (await readLatestRunId(deps));
  if (!id) return undefined;
  if (!/^run-[A-Za-z0-9._-]+$/.test(id)) throw new Error(`Invalid run id: ${id}`);
  try {
    const raw = await readFile(join(runsDir(deps), `${id}.json`), "utf8");
    return JSON.parse(raw) as MadRunSnapshot;
  } catch {
    return undefined;
  }
}

function createRuntime(snapshot: MadRunSnapshot): GodRuntime {
  const ctx = new Context();
  applyInvariants(ctx);
  return GodRuntime.restore(ctx, snapshot);
}

function createRuntimeForRun(options: {
  budgets: { concurrency?: number; tokens?: number; timeMs?: number; costUsd?: number };
  maxAgents: number;
  models: readonly string[];
}): GodRuntime {
  const ctx = new Context();
  applyInvariants(ctx);
  const runtime = new GodRuntime(ctx, { budgets: options.budgets, maxAgents: options.maxAgents });
  const provider = providerId("cli");
  const credential = credentialId("cli-default");
  runtime.registry.register({
    id: provider,
    name: "CodeFusion CLI",
    credentials: [
      {
        id: credential,
        providerId: provider,
        models: options.models.map((model) => ({
          id: modelId(model),
          name: model,
          instances: [
            {
              id: instanceId(`${model}#1`),
              modelId: modelId(model),
              providerId: provider,
              credentialId: credential,
              available: true,
              healthy: true,
            },
          ],
        })),
      },
    ],
  });
  return runtime;
}

export const runMadCommand = async (
  ctx: RunContext,
  options: GlobalOptions,
  deps: MadCommandDependencies,
  args: string[],
): Promise<number> => {
  const { positionals, flags } = parseArgs(args);
  const subcommand = positionals[0] ?? "status";
  try {
    switch (subcommand) {
      case "status":
        return await runStatus(ctx, options, deps);
      case "run":
        return await runStart(ctx, options, deps, positionals.slice(1), flags);
      case "list":
        return await runList(ctx, options, deps);
      case "show":
        return await runShow(ctx, options, deps, positionals[1]);
      case "discuss":
        return await runDiscuss(ctx, options, deps, positionals.slice(1), flags);
      case "claim":
        return await runClaim(ctx, options, deps, positionals.slice(1), flags);
      case "resolve":
        return await runResolve(ctx, options, deps, positionals[1], flags);
      case "arbiter":
        return await runArbiter(ctx, options, deps, positionals[1], positionals[2], flags);
      case "complete":
        return await runComplete(ctx, options, deps, positionals[1], flags);
      case "cancel":
        return await runCancel(ctx, options, deps, positionals.slice(1));
      case "finalize":
        return await runFinalize(ctx, options, deps);
      default:
        ctx.stderr.write(`Unknown mad command: ${subcommand}\n${MAD_COMMAND_USAGE}\n`);
        return 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`Error: ${message}\n`);
    if (options.verbose && error instanceof Error && error.stack) ctx.stderr.write(`${error.stack}\n`);
    return 1;
  }
};

async function runStatus(ctx: RunContext, options: GlobalOptions, deps: MadCommandDependencies): Promise<number> {
  const latest = await readRun(deps);
  if (options.json) {
    ctx.stdout.write(
      formatJson({
        directory: madRoot(deps),
        services: ["god-runtime", "discussion-bus", "cf-verification"],
        modes: Object.keys(MAD_DECOMPOSITION),
        decomposition: MAD_DECOMPOSITION,
        latest: latest ?? null,
      }),
    );
    return 0;
  }
  const lines = [
    "MAD runtime — god-runtime + discussion-bus + cf-verification (cordis services)",
    `runs: ${madRoot(deps)}`,
    `modes: ${Object.keys(MAD_DECOMPOSITION).join(", ")}`,
  ];
  for (const [mode, labels] of Object.entries(MAD_DECOMPOSITION)) {
    lines.push(`  ${mode}: ${labels.join(" → ")}`);
  }
  if (!latest) {
    lines.push("", "No run yet. Start one with: cf mad run <task> --models <a,b>");
  } else {
    lines.push(
      "",
      `latest: ${latest.runId} [${latest.mode}] ${latest.status}`,
      `  task: ${latest.description}`,
      `  tasks: ${latest.tasks.length} (assigned ${latest.tasks.filter((t) => t.assigned.length > 0).length})`,
      `  claims: ${latest.claims.length} (accepted ${latest.claims.filter((c) => c.status === "accepted").length})`,
      `  discussion: ${latest.discussion.length} messages`,
      `  budget: ${JSON.stringify(latest.budgets)}`,
    );
  }
  ctx.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function runStart(
  ctx: RunContext,
  options: GlobalOptions,
  deps: MadCommandDependencies,
  words: string[],
  flags: Flags,
): Promise<number> {
  const description = words.join(" ").trim();
  if (!description) {
    ctx.stderr.write(`Missing task description.\n${MAD_COMMAND_USAGE}\n`);
    return 1;
  }
  const models = flagList(flags, "models");
  if (models.length === 0) {
    ctx.stderr.write("Missing --models <a,b,c>: MAD routes across the models you name.\n");
    return 1;
  }
  const mode = (flagValue(flags, "mode") ?? "PLAN").toUpperCase() as MadMode;
  if (!(mode in MAD_DECOMPOSITION)) {
    ctx.stderr.write(`Unknown mode: ${mode}\n`);
    return 1;
  }
  const maxAgents = Number(flagValue(flags, "max-agents") ?? models.length);
  const budgets = {
    ...DEFAULT_BUDGET,
    ...(flagValue(flags, "tokens") ? { tokens: Number(flagValue(flags, "tokens")) } : {}),
    ...(flagValue(flags, "time-ms") ? { timeMs: Number(flagValue(flags, "time-ms")) } : {}),
    ...(flagValue(flags, "cost") ? { costUsd: Number(flagValue(flags, "cost")) } : {}),
    ...(flagValue(flags, "concurrency") ? { concurrency: Number(flagValue(flags, "concurrency")) } : {}),
  };
  const runtime = createRuntimeForRun({ budgets, maxAgents, models });
  await runtime.initializeTask({ description, mode, maxAgents });
  const taskIds = await runtime.decomposeTask();
  for (const id of taskIds) runtime.routeTask(id);
  const snapshot = runtime.snapshot();
  const path = await writeRun(deps, snapshot);
  const ordersPath = await writeWorkOrders(deps, snapshot);

  if (options.json) {
    ctx.stdout.write(formatJson({ run: snapshot, path, ordersPath }));
    return 0;
  }
  const lines = [
    `MAD run ${snapshot.runId} [${snapshot.mode}] started`,
    `models: ${models.join(", ")}`,
    `budget: ${JSON.stringify(snapshot.budgets)}`,
    `snapshot: ${path}`,
    `work orders: ${ordersPath}`,
    "",
  ];
  for (const task of snapshot.tasks) {
    lines.push(`- ${task.id} (${task.label}) → ${task.assigned.join(", ") || "unassigned"}`);
  }
  lines.push(
    "",
    "Next: run each work order with /workflow, then record outcomes:",
    "  cf mad complete <taskId> --ok|--fail",
    "  cf mad claim <text> --evidence <file:line|test-name>",
  );
  ctx.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function writeWorkOrders(deps: MadCommandDependencies, snapshot: MadRunSnapshot): Promise<string> {
  const directory = runsDir(deps);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${snapshot.runId}.orders.md`);
  const lines = [
    `# MAD work orders — ${snapshot.runId}`,
    "",
    `Task: ${snapshot.description}`,
    `Mode: ${snapshot.mode}`,
    "",
    "Execute every order, then report evidence back to the run:",
    "",
  ];
  for (const task of snapshot.tasks) {
    lines.push(
      `## ${task.id} — ${task.label}`,
      `agents: ${task.assigned.join(", ") || "none (register more models)"}`,
      `depends on: ${task.dependsOn.join(", ") || "-"}`,
      "",
      `Deliver the \`${task.label}\` step for: ${snapshot.description}`,
      "Cite evidence as `path:line`, a test name, or a command output hash.",
      "",
    );
  }
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

async function runList(ctx: RunContext, options: GlobalOptions, deps: MadCommandDependencies): Promise<number> {
  let files: string[];
  try {
    files = await readdir(runsDir(deps));
  } catch {
    files = [];
  }
  const runs = files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
  const latest = await readLatestRunId(deps);
  if (options.json) {
    ctx.stdout.write(formatJson({ directory: runsDir(deps), runs, latest: latest ?? null }));
    return 0;
  }
  if (runs.length === 0) {
    ctx.stdout.write(`No MAD runs in ${runsDir(deps)}\n`);
    return 0;
  }
  ctx.stdout.write(`${runs.map((id) => `${id === latest ? "*" : " "} ${id}`).join("\n")}\n`);
  return 0;
}

async function runShow(
  ctx: RunContext,
  options: GlobalOptions,
  deps: MadCommandDependencies,
  runId?: string,
): Promise<number> {
  const snapshot = await readRun(deps, runId);
  if (!snapshot) {
    ctx.stderr.write(`No MAD run found${runId ? `: ${runId}` : ""} in ${runsDir(deps)}\n`);
    return 1;
  }
  if (options.json) {
    ctx.stdout.write(formatJson(snapshot));
    return 0;
  }
  const lines = [
    `run ${snapshot.runId} [${snapshot.mode}] ${snapshot.status}`,
    `task: ${snapshot.description}`,
    ...(snapshot.cancelledReason ? [`cancelled: ${snapshot.cancelledReason}`] : []),
    `started: ${new Date(snapshot.startedAt).toISOString()}`,
    `usage: ${JSON.stringify(snapshot.usage)}`,
    "",
    "tasks:",
  ];
  for (const task of snapshot.tasks) {
    lines.push(`- ${task.id} (${task.label}) [${task.status}] → ${task.assigned.join(", ") || "-"}`);
  }
  lines.push("", "claims:");
  if (snapshot.claims.length === 0) lines.push("- none");
  for (const claim of snapshot.claims) {
    lines.push(`- ${claim.id} [${claim.status}] ${claim.text} (evidence: ${claim.evidence.join(", ") || "none"})`);
  }
  lines.push("", `discussion: ${snapshot.discussion.length} messages`);
  for (const message of snapshot.discussion.slice(-10)) {
    lines.push(`- r${message.round} ${message.kind} ${message.agentId}: ${message.text}`);
  }
  ctx.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

async function mutateLatest(
  deps: MadCommandDependencies,
  mutate: (runtime: GodRuntime) => string,
): Promise<{ snapshot: MadRunSnapshot; message: string; path: string }> {
  const snapshot = await readRun(deps);
  if (!snapshot) throw new Error(`No MAD run found in ${runsDir(deps)} — start one with cf mad run`);
  if (snapshot.status === "cancelled") throw new Error(`MAD run ${snapshot.runId} is cancelled`);
  const runtime = createRuntime(snapshot);
  const message = mutate(runtime);
  const updated = runtime.snapshot();
  const path = await writeRun(deps, updated);
  return { snapshot: updated, message, path };
}

async function runDiscuss(
  ctx: RunContext,
  options: GlobalOptions,
  deps: MadCommandDependencies,
  words: string[],
  flags: Flags,
): Promise<number> {
  const text = words.join(" ").trim();
  if (!text) {
    ctx.stderr.write(`Missing discussion text.\n${MAD_COMMAND_USAGE}\n`);
    return 1;
  }
  const kind = (flagValue(flags, "kind") ?? "hypothesis") as "claim" | "hypothesis" | "question" | "evidence" | "counterargument";
  const author = flagValue(flags, "author") ?? "agent";
  const result = await mutateLatest(deps, (runtime) => {
    const message = runtime.discuss(kind, text, author);
    return `r${message.round} ${message.kind} ${message.agentId}: ${message.text}`;
  });
  if (options.json) {
    ctx.stdout.write(formatJson({ runId: result.snapshot.runId, message: result.message, path: result.path }));
    return 0;
  }
  ctx.stdout.write(`${result.message}\n`);
  return 0;
}

async function runClaim(
  ctx: RunContext,
  options: GlobalOptions,
  deps: MadCommandDependencies,
  words: string[],
  flags: Flags,
): Promise<number> {
  const text = words.join(" ").trim();
  if (!text) {
    ctx.stderr.write("Missing claim text.\n");
    return 1;
  }
  const evidence = flagList(flags, "evidence");
  const author = flagValue(flags, "author") ?? "agent";
  const result = await mutateLatest(deps, (runtime) => {
    const claim: MadClaim = runtime.recordClaim({ text, evidence, author });
    return `${claim.id} [${claim.status}] ${claim.text}`;
  });
  if (options.json) {
    ctx.stdout.write(formatJson({ runId: result.snapshot.runId, claim: result.message, path: result.path }));
    return 0;
  }
  ctx.stdout.write(`${result.message}\n`);
  if (evidence.length === 0) {
    ctx.stdout.write("No evidence supplied — claim stays 'proposed' and blocks finalize.\n");
  }
  return 0;
}

async function runResolve(
  ctx: RunContext,
  options: GlobalOptions,
  deps: MadCommandDependencies,
  id: string | undefined,
  flags: Flags,
): Promise<number> {
  if (!id) {
    ctx.stderr.write(`Missing claim id.\n${MAD_COMMAND_USAGE}\n`);
    return 1;
  }
  const accept = flagValue(flags, "accept") === "true" || flags["accept"]?.length === 1;
  const reject = flagValue(flags, "reject") === "true";
  if (accept === reject) {
    ctx.stderr.write("Pass exactly one of --accept or --reject.\n");
    return 1;
  }
  const result = await mutateLatest(deps, (runtime) => {
    const claim = runtime.resolveClaim(claimId(id), accept);
    return `${claim.id} [${claim.status}]`;
  });
  if (options.json) {
    ctx.stdout.write(formatJson({ runId: result.snapshot.runId, claim: result.message }));
    return 0;
  }
  ctx.stdout.write(`${result.message}\n`);
  return 0;
}

async function runArbiter(
  ctx: RunContext,
  options: GlobalOptions,
  deps: MadCommandDependencies,
  aLabel: string | undefined,
  bLabel: string | undefined,
  flags: Flags,
): Promise<number> {
  if (!aLabel || !bLabel) {
    ctx.stderr.write(`Arbiter needs two competing judgments.\n${MAD_COMMAND_USAGE}\n`);
    return 1;
  }
  const judgments: Judgment[] = [
    { label: aLabel, evidence: evidenceFor(flags, aLabel) },
    { label: bLabel, evidence: evidenceFor(flags, bLabel) },
  ];
  const runtime = createRuntimeForRun({
    budgets: { concurrency: 1 },
    maxAgents: 1,
    models: ["arbiter"],
  });
  const decision = runtime.arbiter.decide(judgments[0]!, judgments[1]!);
  if (options.json) {
    ctx.stdout.write(formatJson(decision));
    return decision.decisive ? 0 : 2;
  }
  ctx.stdout.write(
    `${decision.decisive ? "decided" : "undecided"}: ${decision.winner ?? "no winner"}\n${decision.reason}\n` +
      `evidence: ${decision.evidenceHashes.join(", ") || "none"}\n`,
  );
  return decision.decisive ? 0 : 2;
}

function evidenceFor(flags: Flags, label: string): string[] {
  const entries = flags["evidence"] ?? [];
  return entries
    .filter((entry) => entry.startsWith(`${label}=`))
    .flatMap((entry) => entry.slice(label.length + 1).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

async function runComplete(
  ctx: RunContext,
  options: GlobalOptions,
  deps: MadCommandDependencies,
  id: string | undefined,
  flags: Flags,
): Promise<number> {
  if (!id) {
    ctx.stderr.write("Missing task id.\n");
    return 1;
  }
  const success = flagValue(flags, "fail") !== "true";
  const result = await mutateLatest(deps, (runtime) => {
    runtime.completeTask(taskId(id), success);
    return `${id} → ${success ? "done" : "failed"}`;
  });
  if (options.json) {
    ctx.stdout.write(formatJson({ runId: result.snapshot.runId, task: result.message }));
    return 0;
  }
  ctx.stdout.write(`${result.message}\n`);
  return 0;
}

async function runCancel(
  ctx: RunContext,
  options: GlobalOptions,
  deps: MadCommandDependencies,
  words: string[],
): Promise<number> {
  const reason = words.join(" ").trim() || "cancelled by operator";
  const result = await mutateLatest(deps, (runtime) => {
    runtime.cancelRun(reason);
    return `cancelled: ${reason}`;
  });
  if (options.json) {
    ctx.stdout.write(formatJson({ runId: result.snapshot.runId, cancelled: reason }));
    return 0;
  }
  ctx.stdout.write(`${result.message}\n`);
  return 0;
}

async function runFinalize(
  ctx: RunContext,
  options: GlobalOptions,
  deps: MadCommandDependencies,
): Promise<number> {
  const result = await mutateLatest(deps, (runtime) => {
    const report = runtime.finalize();
    return formatJson(report);
  });
  if (options.json) {
    ctx.stdout.write(formatJson({ report: JSON.parse(result.message), path: result.path }));
    return 0;
  }
  ctx.stdout.write(`${result.message}\n`);
  return 0;
}
