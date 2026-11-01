// ============================================================
// Workflow Actor Identity Section Builder
// ============================================================
//
//
//

import type { ContextSection, WorkflowActorContext } from "../types.js";
import { estimateTokens } from "../utils.js";
import { buildHarnessBlock, buildSecurityNotice } from "./identity.js";

const TOOL_SURFACE =
  "You have the regular working tools — reading, searching, editing, running commands — plus `submit_result` and `escalate`. There is no tool that asks a person anything.";

const EVIDENCE_RULE =
  "Ground every claim in something you read or ran in this session, or in the material the ask gave you, and say which. Cite code as `path:line`. A check counts as passed only if you executed it here; if you could not run it, report it as not run. Run the check an ask names rather than a faster substitute, and say exactly which command you ran.";

function buildWorkflowContract(): string {
  return [
    "# Working inside a workflow",
    `- ${TOOL_SURFACE}`,
    "- Each ask states what to do. When the ask carries a result schema, finish by calling `submit_result` with a conforming value; otherwise your final message is the result.",
    `- ${EVIDENCE_RULE}`,
    "- Report outcomes faithfully. If part of the task is impossible, out of scope, or contradicted by what you found, say so in the result instead of filling a field with a plausible guess. Never fake a passing result to satisfy an instruction.",
    "- When you are blocked by something outside your reach — a gate that cannot pass, instructions that contradict each other, a fact only the run's owner knows — call `escalate`. Questions written in prose reach nobody.",
    "- Do not write report or summary files on your own initiative; findings go in the result. When the ask names an output path, write exactly there and return that path in the result — the script publishes it to the user.",
  ].join("\n");
}

function buildWorkflowActorIdentityPrompt(actor: WorkflowActorContext): string {
  const name = actor.name?.trim();
  const named = name ? `, named "${name}"` : "";
  const opening = [
    `You are a subagent inside a dynamic workflow run${named}. A script created you and hands you work one ask at a time; the script — not a person — consumes what you return. There is no user in this conversation to talk to.`,
  ];
  const persona = actor.persona?.trim();
  const parts = [
    opening.join("\n"),
    ...(persona ? ["", persona] : []),
    "",
    buildSecurityNotice(),
    "",
    buildHarnessBlock(),
    "",
    buildWorkflowContract(),
  ];
  return parts.join("\n");
}

export function buildWorkflowActorIdentitySection(actor: WorkflowActorContext): ContextSection {
  const content = buildWorkflowActorIdentityPrompt(actor);
  return {
    name: "Workflow Actor Identity",
    source: "workflow_actor_identity",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
