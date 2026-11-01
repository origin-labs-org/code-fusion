// ============================================================
// ============================================================

import type {
  DynamicWorkflowRunError,
  DynamicWorkflowRunHole,
  DynamicWorkflowRunPendingQuestion,
} from "@origin-ai/cf-contracts";
import { escapeXml, truncateTaskNotification } from "./notification.js";

const SYSTEM_NOTIFICATION_BANNER = [
  "[SYSTEM NOTIFICATION - NOT USER INPUT]",
  "This is an automated workflow event, NOT a message from the user.",
  "Do NOT interpret this as user acknowledgement, confirmation, or response to any pending question.",
  "",
] as const;

export function formatWorkflowProviderStopError(
  failure: DynamicWorkflowRunError,
  runId: string,
): string {
  const details = failure.providerStop;
  if (details === undefined) return failure.message;
  const provider = details.providerLabel ?? details.providerId ?? "the provider";
  const providerRef =
    details.providerLabel !== undefined && details.providerId !== undefined
      ? `${details.providerLabel} (${details.providerId})`
      : provider;
  const subagent = details.subagentName ?? details.subagent ?? "a subagent";
  const phase = details.phase === undefined ? "" : ` (phase "${details.phase}")`;
  const model = details.modelId ?? "the current model";
  const code = details.providerCode ?? details.reason;
  const resume = `then call ResumeWorkflowRun with run_id="${runId}"`;
  const sentences = ((): [string, string] => {
    switch (details.kind) {
      case "auth":
        return [
          `Sign-in to ${providerRef} expired while subagent ${subagent}${phase} was running.`,
          `Ask the user to sign in to ${provider} again, ${resume}. Finished steps are kept.`,
        ];
      case "not_configured":
        return [
          `Provider ${details.providerId ?? provider} is not configured on this machine, so subagent ${subagent}${phase} could not send its request.`,
          `Ask the user to configure the provider or switch this session to another model, ${resume}.`,
        ];
      case "model_unavailable":
        return [
          `Model ${model} is not available on ${provider} (not in the user's plan, or retired).`,
          `Ask the user to switch this session to a model the plan includes, ${resume}. Subagents follow the session's model.`,
        ];
      case "invalid_request":
        return [
          `${provider} rejected subagent ${subagent}${phase}'s request as invalid (code ${code}).`,
          `Switching the session to another model usually clears this; ${resume}. If it stops again with the same code, show the raw message to the user.`,
        ];
      case "quota":
        return details.resetAt === undefined
          ? [
              `${provider} reports the user's quota is exhausted (code ${code}).`,
              `Ask the user to top up or upgrade the plan, or switch to another provider, ${resume}.`,
            ]
          : [
              `${provider} reports the user's usage cap is reached (code ${code}); it resets at ${new Date(details.resetAt).toISOString()}.`,
              `Tell the user; after the reset, call ResumeWorkflowRun with run_id="${runId}". Do not rebuild the workflow.`,
            ];
      default:
        return [
          `${provider} refused subagent ${subagent}${phase}'s request with a permanent error (code ${code}).`,
          `Resolve it with the user (the raw message below says what the provider wants), ${resume}.`,
        ];
    }
  })();
  const facts = [
    `provider=${details.providerId ?? "unknown"}`,
    `model=${details.modelId ?? "unknown"}`,
    `subagent=${details.subagent ?? "unknown"}`,
    ...(details.phase === undefined ? [] : [`phase=${details.phase}`]),
    `code=${code}`,
  ].join(" ");
  return [
    sentences[0],
    sentences[1],
    facts,
    ...(details.rawMessage === undefined ? [] : [`raw: ${details.rawMessage}`]),
  ].join("\n");
}

export interface WorkflowStallNotificationInput {
  runLabel: string;
  runId: string;
  sinceMs: number;
  reason?: string;
  cap?: number;
}

export function formatWorkflowStallNotification(input: WorkflowStallNotificationInput): string {
  const minutes = Math.max(1, Math.round(input.sinceMs / 60_000));
  const lines = [
    ...SYSTEM_NOTIFICATION_BANNER,
    "<workflow-stall>",
    `  <run-id>${escapeXml(input.runId)}</run-id>`,
    `  <run>${escapeXml(input.runLabel)}</run>`,
    `  <since-ms>${Math.max(0, Math.floor(input.sinceMs))}</since-ms>`,
  ];
  if (input.reason !== undefined) {
    lines.push(`  <dominant-reason>${escapeXml(input.reason)}</dominant-reason>`);
  }
  if (input.cap !== undefined) lines.push(`  <cap>${input.cap}</cap>`);
  const reasonClause =
    input.reason === undefined
      ? "the provider keeps failing requests"
      : `the provider keeps answering ${input.reason}`;
  const capClause = input.cap === undefined ? "" : ` (current fan-out ${input.cap})`;
  lines.push(
    "</workflow-stall>",
    "",
    `Workflow run ${input.runLabel} (${input.runId}) has not completed a model request in ${minutes} minutes; ${reasonClause} and the run is retrying with backoff${capClause}.`,
    "It is still running and needs nothing from you. Tell the user if they are waiting on it; they can stop it from the run card. Do not cancel or rebuild it on your own.",
  );
  return truncateTaskNotification(lines.join("\n"));
}

export interface WorkflowEscalationNotificationInput {
  
  runLabel: string;
  runId: string;
  qid: string;
  
  actor: string;
  question: string;
  context?: string;
}

export function formatWorkflowEscalationNotification(
  input: WorkflowEscalationNotificationInput,
): string {
  const lines = [
    ...SYSTEM_NOTIFICATION_BANNER,
    "<workflow-escalation>",
    `  <run-id>${escapeXml(input.runId)}</run-id>`,
    `  <run>${escapeXml(input.runLabel)}</run>`,
    `  <question-id>${escapeXml(input.qid)}</question-id>`,
    `  <subagent>${escapeXml(input.actor)}</subagent>`,
    `  <question>${escapeXml(input.question)}</question>`,
  ];
  if (input.context !== undefined && input.context.length > 0) {
    lines.push(`  <context>${escapeXml(input.context)}</context>`);
  }
  lines.push(
    "</workflow-escalation>",
    "",
    `Subagent ${input.actor} in workflow run ${input.runLabel} (${input.runId}) escalated a blocking question and is parked on that call waiting for your answer.`,
    `Next step: call ResolveWorkflowQuestion with question_id="${input.qid}" and your answer.`,
    "The run is still running: only the subagent that asked is parked — every other subagent and the script's control flow keep going. So do not drop what you are doing, but do not leave it unanswered either: nothing times out on its behalf.",
    "If this notification is ever lost, GetWorkflowRun lists the questions this run still owes an answer to.",
  );
  return truncateTaskNotification(lines.join("\n"));
}

export interface WorkflowHoleNotificationInput {
  runLabel: string;
  runId: string;
  holeId: string;
  name: string;
  type: string;
  prompt?: string;
  draftPath?: string;
  line?: number;
  before?: string;
  after?: string;
}

export function formatWorkflowHoleNotification(input: WorkflowHoleNotificationInput): string {
  const lines = [
    ...SYSTEM_NOTIFICATION_BANNER,
    "<workflow-hole>",
    `  <run-id>${escapeXml(input.runId)}</run-id>`,
    `  <run>${escapeXml(input.runLabel)}</run>`,
    `  <hole-id>${escapeXml(input.holeId)}</hole-id>`,
    `  <name>${escapeXml(input.name)}</name>`,
    `  <type>${escapeXml(input.type)}</type>`,
  ];
  if (input.prompt !== undefined && input.prompt.length > 0) {
    lines.push(`  <prompt>${escapeXml(input.prompt)}</prompt>`);
  }
  if (input.draftPath !== undefined) lines.push(`  <draft>${escapeXml(input.draftPath)}</draft>`);
  if (input.line !== undefined) lines.push(`  <line>${input.line}</line>`);
  if (input.before !== undefined) lines.push(`  <before>${escapeXml(input.before)}</before>`);
  if (input.after !== undefined) lines.push(`  <after>${escapeXml(input.after)}</after>`);
  const where =
    input.before !== undefined && input.after !== undefined
      ? ` between phases "${input.before}" and "${input.after}"`
      : input.before !== undefined
        ? ` after phase "${input.before}"`
        : input.after !== undefined
          ? ` before phase "${input.after}"`
          : "";
  const draft =
    input.draftPath === undefined
      ? "Read the run's script with GetWorkflowRun for the context"
      : `Read the draft at ${input.draftPath}${input.line === undefined ? "" : ` (the hole is on line ${input.line})`} for the context`;
  lines.push(
    "</workflow-hole>",
    "",
    `Workflow run ${input.runLabel} (${input.runId}) reached the hole "${input.name}" (${input.holeId})${where} and is waiting for you to write its body.`,
    `Next step: ${draft}, write the statements of the hole's function, and call FillWorkflowHole with run_id="${input.runId}" and hole_id="${input.holeId}" and the body as \`script\`.`,
    `The body is compiled where the hole stands and sees every binding declared before it; it must return a value of type \`${input.type}\` — or, when the next step is not known yet, do one step and end with a new tail hole of the same type named for the next step (\`return await hole<${input.type}>("…", …)\`); the last fill returns. Write only the statements — not the hole call, not an arrow, not the script around it.`,
    "Only this branch of the script is parked — every other subagent and the rest of the control flow keep going. So do not drop what you are doing, but do not leave it unfilled either: nothing times out on its behalf.",
    "If this notification is ever lost, GetWorkflowRun lists the holes this run is still waiting at.",
  );
  return truncateTaskNotification(lines.join("\n"));
}

export interface WorkflowBlockedNotificationInput {
  runLabel: string;
  runId: string;
  
  ordinal: number;
  total: number;
  
  now: number;
  questions: readonly DynamicWorkflowRunPendingQuestion[];
  
  holes: readonly DynamicWorkflowRunHole[];
  draftPath?: string;
}

const WORKFLOW_BLOCKED_MAX_LISTED = 8;

const WORKFLOW_BLOCKED_TEXT_MAX_CHARS = 2_000;
const MS_PER_MINUTE = 60_000;

function boundBlockedText(value: string): string {
  if (value.length <= WORKFLOW_BLOCKED_TEXT_MAX_CHARS) return value;
  return `${value.slice(0, WORKFLOW_BLOCKED_TEXT_MAX_CHARS - 1)}…`;
}

function waitedMs(now: number, since: number | undefined): number {
  return since === undefined ? 0 : Math.max(0, Math.floor(now - since));
}

function countNoun(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function formatWorkflowBlockedNotification(input: WorkflowBlockedNotificationInput): string {
  const { questions, holes, now, runId } = input;
  const lines: string[] = [
    ...SYSTEM_NOTIFICATION_BANNER,
    "<workflow-blocked>",
    `  <run-id>${escapeXml(runId)}</run-id>`,
    `  <run>${escapeXml(input.runLabel)}</run>`,
    `  <reminder>${input.ordinal} of ${input.total}</reminder>`,
  ];
  const shownQuestions = questions.slice(0, WORKFLOW_BLOCKED_MAX_LISTED);
  if (questions.length > 0) {
    lines.push(`  <open-questions count="${questions.length}" shown="${shownQuestions.length}">`);
    for (const question of shownQuestions) {
      const subagent = question.actorName ?? question.actor;
      lines.push(
        `    <question id="${escapeXml(question.qid)}" subagent="${escapeXml(subagent)}" waited-ms="${waitedMs(now, question.askedAt)}">`,
        `      <text>${escapeXml(boundBlockedText(question.question))}</text>`,
      );
      if (question.context !== undefined && question.context.length > 0) {
        lines.push(`      <context>${escapeXml(boundBlockedText(question.context))}</context>`);
      }
      lines.push("    </question>");
    }
    lines.push("  </open-questions>");
  }
  const shownHoles = holes.slice(0, WORKFLOW_BLOCKED_MAX_LISTED);
  if (holes.length > 0) {
    lines.push(`  <open-holes count="${holes.length}" shown="${shownHoles.length}">`);
    for (const hole of shownHoles) {
      const line = hole.line === undefined ? "" : ` line="${hole.line}"`;
      lines.push(
        `    <hole id="${escapeXml(hole.siteId)}" name="${escapeXml(hole.name)}" type="${escapeXml(hole.type)}"${line} waited-ms="${waitedMs(now, hole.since)}"/>`,
      );
    }
    lines.push("  </open-holes>");
  }
  if (input.draftPath !== undefined) lines.push(`  <draft>${escapeXml(input.draftPath)}</draft>`);
  lines.push("</workflow-blocked>", "");

  const total = questions.length + holes.length;
  const oldest = Math.max(
    0,
    ...questions.map((question) => waitedMs(now, question.askedAt)),
    ...holes.map((hole) => waitedMs(now, hole.since)),
  );
  const minutes = Math.max(1, Math.round(oldest / MS_PER_MINUTE));
  const what = [
    ...(questions.length > 0 ? [countNoun(questions.length, "question")] : []),
    ...(holes.length > 0 ? [countNoun(holes.length, "hole")] : []),
  ].join(" and ");
  lines.push(
    total === 1
      ? `Workflow run ${input.runLabel} (${runId}) is still waiting on you: ${what} is open, for ${minutes} minutes, and you have not acted on it since your last turn ended.`
      : `Workflow run ${input.runLabel} (${runId}) is still waiting on you: ${what} are open, the oldest for ${minutes} minutes, and you have not acted on them since your last turn ended.`,
  );
  if (questions.length > 0) {
    lines.push(
      "Next step for each question: call ResolveWorkflowQuestion with its id as question_id and your answer.",
    );
  }
  if (holes.length > 0) {
    const context =
      input.draftPath === undefined
        ? `read the run's script with GetWorkflowRun (run_id="${runId}")`
        : `read the draft at ${input.draftPath}`;
    lines.push(
      `Next step for each hole: ${context} for the context, write only the statements of the hole's function returning its type, and call FillWorkflowHole with run_id="${runId}" and its id as hole_id and the body as \`script\`.`,
    );
  }
  if (questions.length > shownQuestions.length || holes.length > shownHoles.length) {
    lines.push(`GetWorkflowRun lists the ones not shown here (run_id="${runId}").`);
  }
  lines.push(
    "If a decision needs the user, tell the user exactly what you need from them and end your turn; do not guess an answer to make the reminders stop.",
    input.ordinal < input.total
      ? "One more reminder follows if nothing changes."
      : "This is the last reminder: nothing further is sent until the user writes or this run's open decisions change.",
    "Either way the parked branches keep waiting; nothing times out on their behalf.",
  );
  return truncateTaskNotification(lines.join("\n"));
}
