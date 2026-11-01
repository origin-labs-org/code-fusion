import type { PermissionOptionsPolicy, PermissionUpdate } from "@origin-ai/cf-contracts";
import { OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME, type CfPermissionOption } from "@origin-ai/cf-shared";

const PROJECT_RULE_INPUT_KEYS = ["command", "url", "file_path", "path", "pattern"] as const;

export const PERMISSION_DENIED_BY_USER_CONTENT =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

export function buildPermissionDeniedContent(feedback?: string): string {
  const trimmed = feedback?.trim();
  return trimmed
    ? `${PERMISSION_DENIED_BY_USER_CONTENT} To tell you how to proceed, the user said:\n${trimmed}`
    : PERMISSION_DENIED_BY_USER_CONTENT;
}

const SESSION_ALLOW_PERMISSION_OPTION_ID = "allowSession";
export const SESSION_ALLOW_PERMISSION_OPTION_KIND = "allow_session";
const SESSION_ALLOW_PERMISSION_OPTION_NAME = "Always allow in this session";

interface PermissionOptionSource {
  approvalMode?: "user-once";
  input?: unknown;
  suggestedPermissionUpdates?: PermissionUpdate[];
  optionsPolicy?: PermissionOptionsPolicy;
  toolName: string;
}

export function buildProtocolPermissionOptions(
  source: PermissionOptionSource,
): CfPermissionOption[] {
  const permissionUpdates = source.suggestedPermissionUpdates?.length
    ? source.suggestedPermissionUpdates
    : defaultPermissionUpdates(source);
  const officialCuaProjectScope = permissionUpdates.some((update) =>
    update.rules.some((rule) => rule.toolName === OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME),
  );
  const options: CfPermissionOption[] = [
    {
      kind: "allow_once",
      name: "Allow once",
      optionId: "allow_once",
      response: {
        decision: "allow",
        reason: "Approved once",
      },
    },
    ...(source.optionsPolicy === "no-always-allow"
      ? []
      : source.optionsPolicy === "session-always-allow"
        ? [
            {
              description: "Do not ask again for this tool in this session",
              kind: SESSION_ALLOW_PERMISSION_OPTION_KIND,
              name: SESSION_ALLOW_PERMISSION_OPTION_NAME,
              optionId: SESSION_ALLOW_PERMISSION_OPTION_ID,
              response: {
                decision: "allow" as const,
                reason: "Approved for this session",
              },
            },
          ]
        : [
            {
              description: officialCuaProjectScope
                ? "Do not ask again for official Computer Use tools in this project"
                : "Do not ask again for matching requests in this project",
              kind: "allow_always" as const,
              name: officialCuaProjectScope
                ? "Always allow Computer Use in this project"
                : "Always allow in this project",
              optionId: "allow_project",
              response: {
                decision: "allow" as const,
                permissionUpdates,
                reason: "Approved for this project",
              },
            },
          ]),
    {
      kind: "deny",
      name: "Deny",
      optionId: "deny",
      response: {
        decision: "deny",
        reason: PERMISSION_DENIED_BY_USER_CONTENT,
      },
    },
  ];
  return source.approvalMode === "user-once"
    ? options.filter((option) => option.kind === "allow_once" || option.kind === "deny")
    : options;
}

export function buildSessionPermissionUpdates(toolName: string): PermissionUpdate[] {
  return [{ behavior: "allow", rules: [{ toolName }], type: "addRules" }];
}

export function toLegacyPermissionOptionsPolicy(policy: unknown): "no-always-allow" | undefined {
  switch (policy) {
    case "no-always-allow":
    case "session-always-allow":
      return "no-always-allow";
    default:
      return undefined;
  }
}

function defaultPermissionUpdates(source: PermissionOptionSource): PermissionUpdate[] {
  const ruleContent = ruleContentFromPermissionInput(source.input);
  return [
    {
      behavior: "allow",
      rules: [
        {
          toolName: source.toolName,
          ...(ruleContent ? { ruleContent } : {}),
        },
      ],
      type: "addRules",
    },
  ];
}

function ruleContentFromPermissionInput(input: unknown): string | undefined {
  if (typeof input === "string" && input.trim().length > 0) {
    return input;
  }

  const record = asRecord(input);
  for (const key of PROJECT_RULE_INPUT_KEYS) {
    const value = stringField(record, key);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
