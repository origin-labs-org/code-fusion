import { randomUUID } from "node:crypto";
import {
  CREATE_WORKFLOW_TOOL_NAME,
  boundWorkflowLaunchMeta,
  createWorkflowPhaseAlongside,
  createWorkflowPhaseNames,
  type SavedWorkflowScope,
  type TraceContext,
} from "@origin-ai/cf-contracts";
import type { CompileDiagnostic } from "@origin-ai/cf-dynamic-workflow";
import {
  resolveSavedWorkflow,
  validateWorkflowArgs,
} from "../../tool/handlers/saved-workflows/index.js";
import {
  boundGraphOfAnalysis,
  displayOfAnalysis,
} from "../../tool/handlers/workflow-analysis-display.js";
import { writeWorkflowDraft } from "../../tool/handlers/workflow-drafts.js";
import { analyzeScript } from "../../tool/handlers/workflow-script-analysis.js";
import { bindScriptModels } from "../../tool/handlers/workflow-script-models.js";
import type { ExecutableToolCall } from "../../tool/types.js";
import { uuidv7 } from "@origin-ai/cf-shared";
import { createMessageId, traceContextToLogContext } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { emitControlOnlyUserTurn, persistWorkflowLaunchUserMessage } from "./control-only-turn.js";
import { activateDynamicWorkflowTools } from "./dynamic-workflow-activation.js";

export type StartSavedWorkflowRunResult =
  | { ok: true; runId: string; toolCallId: string }
  | {
      ok: false;
      reason:
        | "invalid_name"
        | "not_found"
        | "invalid_args"
        | "compile_failed"
        | "session_busy"
        | "start_failed";
      message?: string;
    };

const COMPILE_DIAGNOSTICS_MAX_CHARS = 2_000;

export async function startSavedWorkflowRun(
  this: AgentRuntimeInternal,
  input: {
    name: string;
    scope?: SavedWorkflowScope;
    args?: Record<string, unknown>;
    traceContext?: TraceContext;
  },
): Promise<StartSavedWorkflowRunResult> {
  const traceContext = input.traceContext ?? this.rootTraceContext;

  if (this.hasActiveOrQueuedTurnWork()) {
    return { ok: false, reason: "session_busy" };
  }

  const cwd = this.workingDirectory;

  const found = resolveSavedWorkflow({ cwd, name: input.name, scope: input.scope });
  if (!found.ok) {
    if (found.reason === "invalid_name") {
      return {
        ok: false,
        reason: "invalid_name",
        message: `'${input.name}' is not a usable workflow name: ${found.detail}`,
      };
    }
    if (found.reason === "not_found") {
      return {
        ok: false,
        reason: "not_found",
        message:
          input.scope === undefined
            ? `No saved workflow named '${input.name}' in this project or globally.`
            : `No ${input.scope} workflow named '${input.name}'.`,
      };
    }
    return {
      ok: false,
      reason: "not_found",
      message: `The saved workflow '${input.name}' at ${found.path} could not be read: ${found.detail}`,
    };
  }

  const validated = validateWorkflowArgs(found.meta.args, input.args);
  if (!validated.ok) {
    return {
      ok: false,
      reason: "invalid_args",
      message: [
        `The arguments for saved workflow '${found.name}' are not valid:`,
        ...validated.errors.map((error) => `- ${error}`),
      ].join("\n"),
    };
  }

  const analysis = analyzeScript(found.script);
  const models = analysis.ok ? bindScriptModels(analysis, this.modelCatalogPort) : undefined;
  const diagnostics = [...analysis.diagnostics, ...(models?.unbound ?? [])];
  if (!analysis.ok || diagnostics.length > 0) {
    return {
      ok: false,
      reason: "compile_failed",
      message: boundedCompileDiagnostics(
        `The saved workflow '${found.name}' has errors:`,
        diagnostics,
      ),
    };
  }
  const modelSelections = models?.selections;

  const port = this.dynamicWorkflowRunPort;
  if (port === undefined) {
    return { ok: false, reason: "start_failed", message: "dynamic workflow port unavailable" };
  }

  await this.ensureContextInitialized(traceContext);
  await this.ensureSessionPersisted(found.name, traceContext);
  await activateDynamicWorkflowTools.call(this, { source: "run_control", traceContext });

  const toolCallId = `launch-${randomUUID()}`;
  const hasArgs = Object.keys(validated.args).length > 0;
  const launchInputId = uuidv7();
  const launchGraph = boundGraphOfAnalysis(analysis);
  const phaseNames = createWorkflowPhaseNames(launchGraph);
  const phaseAlongside =
    phaseNames === undefined ? undefined : createWorkflowPhaseAlongside(launchGraph);

  const draft = await writeWorkflowDraft({ cwd, name: found.name, source: found.source });

  let runId: string;
  try {
    const submitted = await port.submit({
      scriptText: found.script,
      cwd,
      name: found.name,
      ...(hasArgs ? { args: validated.args } : {}),
      parentSessionId: this.sessionId,
      toolCallId,
      launchInputId,
      ...(phaseNames === undefined ? {} : { phaseNames }),
      ...(phaseAlongside === undefined ? {} : { phaseAlongside }),
      ...(modelSelections === undefined ? {} : { modelBindings: modelSelections }),
      ...(draft === undefined ? {} : { scriptPath: draft.path }),
      trace: traceContext,
    });
    runId = submitted.runId;
  } catch (error) {
    return { ok: false, reason: "start_failed", message: describeError(error) };
  }

  const launchText = buildLaunchMessageText(found.name, found.scope, runId, validated.args);
  const display = displayOfAnalysis(analysis);
  const meta = boundWorkflowLaunchMeta({
    runId,
    toolCallId,
    name: found.name,
    scope: found.scope,
    path: found.path,
    ...(hasArgs ? { args: validated.args } : {}),
    description: found.meta.description,
    ...(display?.kind === "create_workflow" ? { display } : {}),
    script: found.script,
  });

  try {
    const messageId = createMessageId();
    await emitControlOnlyUserTurn.call(this, {
      messageId,
      titleInput: found.name,
      historyText: launchText,
      turnInput: launchText,
      traceContext,
      inputId: launchInputId,
      inputSource: "workflow_launch",
      workflowLaunch: meta,
      persistMessage: () =>
        persistWorkflowLaunchUserMessage.call(this, {
          messageID: messageId,
          text: launchText,
          meta,
          traceContext,
        }),
    });

    const toolCall: ExecutableToolCall = {
      id: toolCallId,
      name: CREATE_WORKFLOW_TOOL_NAME,
      input: {
        name: found.name,
        saved: {
          name: found.name,
          scope: found.scope,
          ...(hasArgs ? { args: validated.args } : {}),
        },
      },
    };
    await this.executor.trackExternalBackgroundTask(
      toolCall,
      { backgroundTaskId: runId, status: "backgrounded" },
      traceContext,
      undefined,
    );
  } catch (error) {
    this.logger?.error(
      "Saved workflow launched but post-submit bookkeeping failed",
      error instanceof Error ? error : new Error(String(error)),
      {
        ...traceContextToLogContext(traceContext),
        event: "dynamic_workflow.launch.post_submit_failed",
        module: "core.runtime",
        runId,
        toolCallId,
      },
    );
  }

  return { ok: true, runId, toolCallId };
}

function buildLaunchMessageText(
  name: string,
  scope: SavedWorkflowScope,
  runId: string,
  args: Record<string, unknown>,
): string {
  const lines = [
    `Started the saved workflow "${name}" (${scope}) from the workflows hub as run ${runId}.`,
  ];
  if (Object.keys(args).length > 0) {
    lines.push("", "Arguments:", "```json", JSON.stringify(args, null, 2), "```");
  }
  lines.push("", "Progress and results arrive as background notifications; do not start it again.");
  return lines.join("\n");
}

export function boundedCompileDiagnostics(
  heading: string,
  diagnostics: readonly CompileDiagnostic[],
): string {
  const body = [
    heading,
    ...diagnostics.map(
      (diagnostic) => `L${diagnostic.line}:C${diagnostic.column} ${diagnostic.message}`,
    ),
  ].join("\n");
  return body.length > COMPILE_DIAGNOSTICS_MAX_CHARS
    ? `${body.slice(0, COMPILE_DIAGNOSTICS_MAX_CHARS - 1)}…`
    : body;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
