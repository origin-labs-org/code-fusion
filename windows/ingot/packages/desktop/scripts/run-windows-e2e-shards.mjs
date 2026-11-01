#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnCancellableStep, startStepExecution } from "./e2e-step-process.mjs";
import {
  hasRequiredSshE2EEnvironment,
  isSshFormalSpec,
} from "./e2e-formal-spec-selection.mjs";

const RUNNER_SHARD_ARG_PREFIX = "--shards=";
const DEFAULT_SPEC_DURATION_PROFILE_PATH = "test/e2e/spec-duration-weights.json";

function readPositiveInteger(value, source) {
  if (!/^\d+$/u.test(value ?? "") || Number(value) <= 0) {
    throw new Error(`${source} must be a positive integer, received: ${value || "<empty>"}`);
  }
  return Number(value);
}

function splitRunnerArgs(args) {
  const shardArgs = args.filter((arg) => arg.startsWith(RUNNER_SHARD_ARG_PREFIX));
  if (shardArgs.length > 1) {
    throw new Error("--shards may only be specified once");
  }

  const explicitShardTotal = shardArgs[0]
    ? readPositiveInteger(shardArgs[0].slice(RUNNER_SHARD_ARG_PREFIX.length), "--shards")
    : undefined;
  return {
    explicitShardTotal,
    wdioArgs: args.filter((arg) => !arg.startsWith(RUNNER_SHARD_ARG_PREFIX)),
  };
}

function isTargetedRun(args, env) {
  const requestedSpec = env.CF_E2E_SPEC?.trim();
  return (
    Boolean(requestedSpec) ||
    args.some(
      (arg, index) =>
        arg === "--spec" ||
        arg.startsWith("--spec=") ||
        (index > 0 && args[index - 1] === "--spec"),
    )
  );
}

function isManualReviewRun(args, env) {
  return (
    env.CF_E2E_MANUAL_REVIEW?.trim() === "1" ||
    args.concat(env.CF_E2E_SPEC ?? "").some((arg) => arg.includes("/manual-review/"))
  );
}

export function resolveWindowsE2EShardTotal({
  args,
  env,
  platform,
  logicalCpuCount = cpus().length,
  totalMemoryBytes = totalmem(),
}) {
  const { explicitShardTotal } = splitRunnerArgs(args);
  const hasNativeShard = args.some((arg) => arg === "--shard" || arg.startsWith("--shard="));
  const isCaptureRun = env.E2E_PROVIDER_HTTP_MODE?.trim() === "capture";
  if (hasNativeShard || isTargetedRun(args, env) || isManualReviewRun(args, env) || isCaptureRun) {
    return 1;
  }

  if (explicitShardTotal !== undefined) {
    return explicitShardTotal;
  }

  const envShardTotal = env.CF_E2E_SHARD_TOTAL?.trim();
  if (envShardTotal) {
    return readPositiveInteger(envShardTotal, "CF_E2E_SHARD_TOTAL");
  }

  void platform;
  void logicalCpuCount;
  void totalMemoryBytes;
  return 1;
}

export function listDefaultFormalE2ESpecs(desktopDir, env = process.env) {
  const e2eDir = join(desktopDir, "test/e2e");
  const specs = [];
  const includeSshSpecs = hasRequiredSshE2EEnvironment(env);
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "manual-review") continue;
        visit(join(directory, entry.name), relativePath);
        continue;
      }
      if (
        entry.isFile() &&
        entry.name.endsWith(".test.ts") &&
        relativePath !== "upstream-provider.test.ts" &&
        (includeSshSpecs || !isSshFormalSpec(`./test/e2e/${relativePath}`))
      ) {
        specs.push(`./test/e2e/${relativePath}`);
      }
    }
  };
  visit(e2eDir);
  return specs;
}

export function partitionE2ESpecsByWeight(specs, shardTotal, profile) {
  const defaultWeightMs = readPositiveInteger(
    String(profile.defaultWeightMs),
    "spec duration defaultWeightMs",
  );
  const buckets = Array.from({ length: shardTotal }, () => ({
    estimatedWeightMs: 0,
    specs: [],
  }));
  const weightedSpecs = specs
    .map((spec) => ({
      spec,
      weightMs: Number(profile.weights?.[spec]) || defaultWeightMs,
    }))
    .sort((left, right) => right.weightMs - left.weightMs || left.spec.localeCompare(right.spec));

  for (const weightedSpec of weightedSpecs) {
    let targetIndex = 0;
    for (let index = 1; index < buckets.length; index += 1) {
      if (buckets[index].estimatedWeightMs < buckets[targetIndex].estimatedWeightMs) {
        targetIndex = index;
      }
    }
    buckets[targetIndex].specs.push(weightedSpec.spec);
    buckets[targetIndex].estimatedWeightMs += weightedSpec.weightMs;
  }

  for (const bucket of buckets) bucket.specs.sort((a, b) => a.localeCompare(b));
  return buckets;
}

function formatRunId(date = new Date()) {
  return `desktop-e2e-${date.toISOString().replace(/[-:.TZ]/gu, "")}`;
}

export function createWindowsE2ERunId({ timestamp, processId, entropy }) {
  return `${formatRunId(timestamp)}-p${processId}-${entropy}`;
}

function createBuildEnv(env) {
  const { NODE_OPTIONS: _nodeOptions, ...buildEnv } = env;
  return {
    ...buildEnv,
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
    VITE_CF_E2E_STORE_BRIDGE: "1",
    CF_DESKTOP_AGENT_BUILD_MODE: env.CF_DESKTOP_AGENT_BUILD_MODE ?? "turbo",
  };
}

export function createWindowsE2EShardPlan({
  args,
  desktopDir,
  env,
  platform,
  processId = process.pid,
  repoRoot,
  runIdEntropy,
  runIdTimestamp = new Date(),
  weightedSpecBuckets,
}) {
  const { wdioArgs } = splitRunnerArgs(args);
  const shardTotal = resolveWindowsE2EShardTotal({ args, env, platform });
  const runId =
    env.CF_E2E_RUN_ID?.trim() ||
    createWindowsE2ERunId({
      entropy: runIdEntropy ?? randomBytes(8).toString("hex"),
      processId,
      timestamp: runIdTimestamp,
    });
  const artifactRoot = resolve(
    env.CF_E2E_ARTIFACT_DIR?.trim() || join(desktopDir, ".e2e-artifacts", runId),
  );
  const explicitHomeRoot = env.CF_E2E_HOME_DIR?.trim();
  const homeRoot = resolve(explicitHomeRoot || join(desktopDir, `.e2e-home-${runId}`));
  const sharded = shardTotal > 1;
  const useWeightedSpecBuckets =
    sharded &&
    weightedSpecBuckets?.length === shardTotal &&
    weightedSpecBuckets.every((bucket) => bucket.specs.length > 0) &&
    !wdioArgs.some((arg) => arg === "--exclude" || arg.startsWith("--exclude="));
  const buildEnv = createBuildEnv(env);

  const buildSteps = sharded
    ? [
        {
          id: "build-desktop",
          kind: "build",
          command: process.execPath,
          args: [join(desktopDir, "scripts/ensure-e2e-desktop-build.mjs")],
          cwd: repoRoot,
          env: buildEnv,
        },
        {
          id: "build-agent",
          kind: "build",
          command: process.execPath,
          args: [join(repoRoot, "scripts/build-desktop-agent-cli.mjs")],
          cwd: repoRoot,
          env: buildEnv,
        },
      ]
    : [];

  const children = Array.from({ length: shardTotal }, (_, offset) => {
    const shardIndex = offset + 1;
    const shardId = `${shardIndex}/${shardTotal}`;
    const shardName = `shard-${shardIndex}-of-${shardTotal}`;
    const childRunId = sharded ? `${runId}-${shardName}` : runId;
    const artifactDir = sharded ? join(artifactRoot, shardName) : artifactRoot;
    const childHomeDir = explicitHomeRoot
      ? sharded
        ? join(homeRoot, runId, shardName)
        : homeRoot
      : sharded
        ? join(desktopDir, `.e2e-home-${runId}-shard-${shardIndex}`)
        : join(desktopDir, `.e2e-home-${runId}`);
    const childEnv = {
      ...env,
      CF_E2E_HOME_DIR: childHomeDir,
      CF_E2E_RUN_ID: childRunId,
      CF_E2E_ARTIFACT_DIR: artifactDir,
      CF_E2E_NETWORK_CAPTURE_DIR: sharded
        ? join(artifactDir, "network-capture")
        : resolve(
            env.CF_E2E_NETWORK_CAPTURE_DIR?.trim() || join(artifactDir, "network-capture"),
          ),
      ...(sharded
        ? {
            CF_E2E_SKIP_BUILD: "1",
            CF_E2E_SKIP_AGENT_BUILD: "1",
          }
        : {}),
      ...(useWeightedSpecBuckets
        ? { CF_E2E_SPEC: weightedSpecBuckets[offset].specs.join(",") }
        : {}),
    };

    return {
      id: shardName,
      kind: "child",
      shardId,
      shardIndex,
      shardTotal,
      command: "pnpm",
      args: [
        "exec",
        "wdio",
        "run",
        "wdio.conf.ts",
        ...wdioArgs,
        ...(sharded && !useWeightedSpecBuckets ? [`--shard=${shardId}`] : []),
      ],
      cwd: desktopDir,
      env: childEnv,
      artifactDir,
      summaryPath: join(artifactDir, "summary.json"),
      ...(useWeightedSpecBuckets
        ? {
            specs: weightedSpecBuckets[offset].specs,
            estimatedWeightMs: weightedSpecBuckets[offset].estimatedWeightMs,
          }
        : {}),
    };
  });

  return {
    runId,
    shardTotal,
    wdioArgs,
    artifactRoot,
    distributionKind: useWeightedSpecBuckets ? "historical-lpt" : "wdio-native",
    manifestPath: join(artifactRoot, "shard-manifest.json"),
    buildSteps,
    children,
  };
}

async function writeShardManifest(path, manifest) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

function printShardManifest(manifest) {
  console.log(`[e2e-shards] ${JSON.stringify(manifest, null, 2)}`);
}

export class WindowsE2EShardRunError extends Error {
  constructor(message, manifest) {
    super(message);
    this.name = "WindowsE2EShardRunError";
    this.manifest = manifest;
  }
}

export async function executeWindowsE2EShardPlan(
  plan,
  {
    now = Date.now,
    signalSource = process,
    spawnStep: runStep = spawnCancellableStep,
    summaryExists = existsSync,
    writeManifest = writeShardManifest,
    printManifest = printShardManifest,
  } = {},
) {
  const startedAtMs = now();
  const activeExecutions = new Set();
  const terminationRequestedExecutions = new WeakSet();
  let interruptedBySignal;

  const terminateActiveExecutions = (excludedExecution) => {
    for (const execution of activeExecutions) {
      if (
        execution === excludedExecution ||
        terminationRequestedExecutions.has(execution) ||
        typeof execution.terminate !== "function"
      ) {
        continue;
      }
      terminationRequestedExecutions.add(execution);
      try {
        execution.terminate();
      } catch {
      }
    }
  };

  const runTrackedStep = (step, { terminatePeersOnStartFailure = false } = {}) => {
    const execution = startStepExecution(runStep, step);
    activeExecutions.add(execution);
    const result = execution.result
      .then((stepResult) => {
        if (terminatePeersOnStartFailure && stepResult.error) {
          terminateActiveExecutions(execution);
        }
        return stepResult;
      })
      .finally(() => activeExecutions.delete(execution));
    return result;
  };

  const signalHandlers = new Map(
    ["SIGINT", "SIGTERM"].map((signal) => [
      signal,
      () => {
        interruptedBySignal ??= signal;
        terminateActiveExecutions();
      },
    ]),
  );
  for (const [signal, handler] of signalHandlers) signalSource.on(signal, handler);

  try {
    for (const buildStep of plan.buildSteps) {
      const result = await runTrackedStep(buildStep);
      if (interruptedBySignal) {
        throw new Error(`parent received ${interruptedBySignal} during ${buildStep.id}`);
      }
      if (result.error) {
        throw new Error(`${buildStep.id} failed to start: ${result.error}`);
      }
      if (result.exitCode !== 0) {
        throw new Error(`${buildStep.id} exited with code ${result.exitCode}`);
      }
    }

    const childResults = await Promise.all(
      plan.children.map(async (child) => ({
        child,
        result: await runTrackedStep(child, { terminatePeersOnStartFailure: true }),
      })),
    );
    for (const childResult of childResults) {
      if (childResult.result.exitCode === 0 && !summaryExists(childResult.child.summaryPath)) {
        childResult.result = {
          exitCode: 1,
          error: `missing shard summary: ${childResult.child.summaryPath}`,
        };
      }
    }
    const finishedAtMs = now();
    const manifest = {
      runId: plan.runId,
      shardTotal: plan.shardTotal,
      distributionKind: plan.distributionKind,
      wallDurationMs: finishedAtMs - startedAtMs,
      manifestPath: plan.manifestPath,
      ...(interruptedBySignal ? { interruptedBySignal } : {}),
      children: childResults.map(({ child, result }) => ({
        shardId: child.shardId,
        exitCode: result.exitCode,
        ...(result.signal ? { signal: result.signal } : {}),
        ...(result.error ? { error: result.error } : {}),
        artifactDir: child.artifactDir,
        summaryPath: child.summaryPath,
        ...(child.specs ? { specs: child.specs } : {}),
        ...(child.estimatedWeightMs ? { estimatedWeightMs: child.estimatedWeightMs } : {}),
      })),
    };

    await writeManifest(plan.manifestPath, manifest);
    printManifest(manifest);

    const failures = manifest.children.filter(
      (child) => child.exitCode !== 0 || child.error || child.signal,
    );
    if (interruptedBySignal || failures.length > 0) {
      const failureMessages = failures.map((child) => {
        if (child.error) return `shard ${child.shardId} failed to start: ${child.error}`;
        if (child.signal) return `shard ${child.shardId} terminated by signal ${child.signal}`;
        return `shard ${child.shardId} exited with code ${child.exitCode}`;
      });
      if (interruptedBySignal) failureMessages.unshift(`parent received ${interruptedBySignal}`);
      throw new WindowsE2EShardRunError(failureMessages.join("; "), manifest);
    }

    return manifest;
  } finally {
    for (const [signal, handler] of signalHandlers) signalSource.off(signal, handler);
  }
}

export async function runWindowsE2EShards({
  args = process.argv.slice(2),
  desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  env = process.env,
  platform = process.platform,
  repoRoot = resolve(desktopDir, "../.."),
} = {}) {
  const shardTotal = resolveWindowsE2EShardTotal({ args, env, platform });
  const useHistoricalWeights =
    shardTotal > 1 &&
    !isTargetedRun(args, env) &&
    !isManualReviewRun(args, env) &&
    env.E2E_PROVIDER_HTTP_MODE?.trim() !== "capture";
  let weightedSpecBuckets;
  if (useHistoricalWeights) {
    const durationProfile = JSON.parse(
      readFileSync(join(desktopDir, DEFAULT_SPEC_DURATION_PROFILE_PATH), "utf-8"),
    );
    weightedSpecBuckets = partitionE2ESpecsByWeight(
      listDefaultFormalE2ESpecs(desktopDir, env),
      shardTotal,
      durationProfile,
    );
  }
  const plan = createWindowsE2EShardPlan({
    args,
    desktopDir,
    env,
    platform,
    repoRoot,
    weightedSpecBuckets,
  });
  return await executeWindowsE2EShardPlan(plan);
}

const isEntrypoint =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  try {
    await runWindowsE2EShards();
  } catch (error) {
    console.error(`[e2e-shards] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
