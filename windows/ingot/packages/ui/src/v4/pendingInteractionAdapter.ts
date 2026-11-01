import type {
  CfPermissionOption,
  CfPermissionRequest,
  CfPermissionResponse,
  CfElicitationRequest,
} from "@origin-ai/cf-shared";
import type {
  PendingInteraction,
  PermissionRequestPayload,
  UserInputRequestPayload,
} from "@origin-ai/cf-shared/cf-protocol-v4";

const LEGACY_PERMISSION_RULE_INPUT_KEYS = [
  "command",
  "url",
  "file_path",
  "path",
  "pattern",
] as const;

function permissionKindToResponse(
  kind: string,
  payload: PermissionRequestPayload,
): CfPermissionResponse {
  if (kind === "deny" || kind === "rejectOnce" || kind === "rejectAlways") {
    return { decision: "deny" };
  }
  if (kind === "allowAlways") {
    const detail =
      typeof payload.detail === "object" && payload.detail !== null
        ? (payload.detail as Record<string, unknown>)
        : {};
    const ruleContent = LEGACY_PERMISSION_RULE_INPUT_KEYS.map((key) => detail[key]).find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    return {
      decision: "allow",
      permissionUpdates: [
        {
          behavior: "allow",
          rules: [
            {
              toolName: payload.toolName,
              ...(ruleContent ? { ruleContent } : {}),
            },
          ],
          type: "addRules",
        },
      ],
    };
  }
  return { decision: "allow" };
}

export function pendingPermissionToLegacyRequest(
  sessionId: string,
  interaction: PendingInteraction & { payload: PermissionRequestPayload },
): CfPermissionRequest {
  const { payload } = interaction;
  const advertisedOptions = payload.fullAccessOption
    ? [...payload.options, payload.fullAccessOption]
    : payload.options;
  const options: CfPermissionOption[] = advertisedOptions.map((option) => ({
    optionId: option.optionId,
    kind: option.kind,
    name: option.label,
    response: option.response ?? permissionKindToResponse(option.kind, payload),
  }));

  return {
    type: "permission_request",
    taskId: sessionId,
    traceId: sessionId,
    requestId: interaction.interactionId,
    description: payload.summary,
    kind: payload.toolName,
    title: payload.toolName,
    options,
    ...(payload.freeText ? { freeText: true } : {}),
    ...(payload.origin ? { origin: payload.origin } : {}),
    ...(payload.display ? { display: payload.display } : {}),
    raw: payload.detail ?? {
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
    },
  };
}

export interface V4UserInputViewModel {
  interactionId: string;
  prompt: string;
  freeText: boolean;
  sensitive?: boolean;
  options: ReadonlyArray<{ optionId: string; label: string }>;
}

export function pendingUserInputToViewModel(
  interaction: PendingInteraction & { payload: UserInputRequestPayload },
): V4UserInputViewModel {
  return {
    interactionId: interaction.interactionId,
    prompt: interaction.payload.prompt,
    freeText: interaction.payload.freeText,
    sensitive: interaction.payload.sensitive,
    options: interaction.payload.options ?? [],
  };
}

export function pendingUserInputToElicitationRequest(
  sessionId: string,
  interaction: PendingInteraction & { payload: UserInputRequestPayload },
): CfElicitationRequest | null {
  const { payload } = interaction;
  if (!payload.questions || payload.questions.length === 0) {
    return null;
  }
  const firstQuestion = payload.questions[0];
  return {
    type: "elicitation_request",
    taskId: sessionId,
    traceId: payload.traceId ?? sessionId,
    requestId: interaction.interactionId,
    message: firstQuestion?.question ?? payload.prompt,
    header: firstQuestion?.header,
    options: firstQuestion?.options ?? [],
    ...(firstQuestion?.multiSelect ? { multiSelect: true } : {}),
    questions: payload.questions,
    ...(payload.currentQuestionIndex !== undefined
      ? { currentQuestionIndex: payload.currentQuestionIndex }
      : {}),
    ...(payload.answerDrafts ? { answerDrafts: payload.answerDrafts } : {}),
    ...(payload.origin ? { origin: payload.origin } : {}),
    schema: payload.schema ?? payload.input,
  };
}
