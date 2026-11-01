import type { CfTaskMode } from "./cf-task-types-core.js";
import type { ModelSelection } from "./model-selection.js";

export type CfOffPeakTaskStatus =
  | "queued"
  | "paused"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export const OFF_PEAK_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

export function isOffPeakTerminalStatus(
  status: CfOffPeakTaskStatus,
): status is "completed" | "failed" | "cancelled" {
  return (OFF_PEAK_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export const OFF_PEAK_TICKET_EXPIRED_MARKER = "off-peak-ticket-expired";

export const OFF_PEAK_PROVIDER_IDS = {
  zai: "account:zai-offpeak-idle-plan",
  bigmodel: "account:bigmodel-offpeak-idle-plan",
} as const;

export function resolveOffPeakProviderId(
  family: "zai" | "bigmodel",
): (typeof OFF_PEAK_PROVIDER_IDS)[typeof family] {
  return OFF_PEAK_PROVIDER_IDS[family];
}

export type OffPeakCodingPlanKind =
  | "zai-personal"
  | "bigmodel-personal"
  | "bigmodel-team"
  | "zai-team";

export type OffPeakCodingPlanUnsupportedReason =
  | "provider_family_unselected"
  | "provider_family_api_key_mode"
  | "provider_identity_mismatch"
  | "connection_unselected"
  | "start_plan_not_supported"
  | "connection_unavailable"
  | "selection_changed"
  | "jwt_missing";

export type OffPeakCodingPlanSupport =
  | {
      supported: true;
      kind: OffPeakCodingPlanKind;
      providerFamily: "zai" | "bigmodel";
      providerId: string;
    }
  | {
      supported: false;
      reason: OffPeakCodingPlanUnsupportedReason;
    };

export interface OffPeakTakeNumberAvailability {
  canTakeNumber: boolean;
  
  nextTakeAt?: number;
}

export function isOffPeakTicketExpiredError(message: string | undefined): boolean {
  return Boolean(message?.includes(OFF_PEAK_TICKET_EXPIRED_MARKER));
}

export interface CfOffPeakTask {
  projectId?: string | null;
  hostId?: string;
  
  additionalDirectories?: string[];
  
  offPeakTaskId: string;
  
  serverTicketId?: string;
  
  title: string;
  
  conversationId?: string;
  
  sessionId?: string;
  
  sessionTitle?: string;
  
  prompt: string;
  
  permissionMode: CfTaskMode;
  
  modelSelection?: ModelSelection;
  
  modelSelectionIssue?: {
    code: "repair-required";
    legacyModelId?: string;
    legacyReasoningLevel?: string;
  };
  /** workspaceIdentity?.trim() || workspacePath */
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  status: CfOffPeakTaskStatus;
  
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  failureReason?: string;
  
  filesChanged?: number;
  
  settledAt?: number;
  
  historyDeletedAt?: number;
  
  registeredAt?: number;
  
  schedulable?: boolean;
  
  queuePosition?: number;
  
  nextPollAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CfOffPeakTaskCreateParams {
  projectId?: string | null;
  hostId?: string;
  
  additionalDirectories?: string[];
  title: string;
  prompt: string;
  permissionMode: CfTaskMode;
  modelSelection: ModelSelection;
  workspacePath: string;
  workspaceIdentity?: string;
  
  boundSessionId?: string;
}

export type OffPeakTaskTicketInitialState =
  | "queued"
  | "ready"
  | "active"
  | "expired"
  | "settled"
  | "not_found";

export type OffPeakTaskCreateFailureStage =
  | "client_validation"
  | "ticket_request"
  | "local_persist";

export type OffPeakTaskCreateErrorCategory =
  | "client_validation"
  | "eligibility_3101"
  | "quota_3103"
  | "network"
  | "invalid_response"
  | "local_persist"
  | "unknown";

export type OffPeakTaskCreateResult =
  | {
      ok: true;
      task: CfOffPeakTask;
      ticketInitialState: OffPeakTaskTicketInitialState;
      queuePosition?: number;
      providerName: string;
    }
  | {
      ok: false;
      failureStage: OffPeakTaskCreateFailureStage;
      errorCategory: OffPeakTaskCreateErrorCategory;
      errorCode: string;
      providerName: string;
    };
