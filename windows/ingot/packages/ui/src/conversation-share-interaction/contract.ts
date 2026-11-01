import type { ReactNode } from "react";
import type { ConversationSharePreflightResult } from "@origin-ai/cf-services";
export type {
  ConversationSharePreflightResult,
  ConversationShareTurnPreflightResult,
  ConversationShareFailureIssue,
} from "@origin-ai/cf-services";

export type ConversationSharePreflightState =
  | { status: "idle" | "checking" }
  | ({ status: "ready" | "stale" } & ConversationSharePreflightResult);

export interface ConversationSharePreflightStatusProps {
  
  onDeselectTurn?: (productTurnId: string) => void;
  
  onRetryPreflight?: () => void;
  preflight?: ConversationSharePreflightState;
}

export interface ConversationSharePopoverProps {
  sessionId: string;
  open: boolean;
  publishing: boolean;
  selecting: boolean;
  onClose: () => void;
  onCancelSelection: () => void;
  children: ReactNode;
}

export interface ConversationSharePreflightRequest<T> {
  request: () => Promise<T>;
  onResolved: (result: T) => void;
  onRejected: (error: unknown) => void;
  onError: (error: unknown) => void;
}
