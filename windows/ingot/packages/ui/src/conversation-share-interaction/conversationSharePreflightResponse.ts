import type {
  ConversationSharePreflightResult,
  ConversationShareTurnPreflightResult,
} from "@/conversation-share-interaction/contract.js";
import type { ConversationRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import { logger } from "@/logger.js";
import {
  getConversationShareErrorDetails,
  resolveConversationShareFallbackIssueCode,
} from "@/lib/conversationShareError.js";
import {
  buildConversationSharePreflightCacheEntries,
  conversationShareTurnFingerprint,
} from "@/v4/conversationSharePreflightCache.js";

type PreflightMeta = Pick<
  ConversationSharePreflightResult,
  "revision" | "logEpoch" | "capabilitiesFingerprint" | "supportedArtifactTypes"
>;

export function createConversationSharePreflightResponseHandlers({
  sessionId,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  missingProductTurnIds,
  requestRows,
  selectedShareTurnFingerprints,
  sharePreflightCacheRef,
  sharePreflightMetaRef,
  sharePreflightCacheKey,
  isCurrent,
  onUpdated,
}: {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  missingProductTurnIds: readonly string[];
  requestRows: readonly ConversationRow[];
  selectedShareTurnFingerprints: ReadonlyMap<string, string>;
  sharePreflightCacheRef: {
    current: Map<string, ConversationShareTurnPreflightResult>;
  };
  sharePreflightMetaRef: { current: PreflightMeta };
  sharePreflightCacheKey: (productTurnId: string) => string;
  isCurrent: () => boolean;
  onUpdated: () => void;
}): {
  onResolved: (result: ConversationSharePreflightResult) => void;
  onRejected: (error: unknown) => void;
  onError: (error: unknown) => void;
} {
  return {
    onResolved: (result) => {
      if (!isCurrent()) return;
      const resultTurnFingerprints = new Map(
        missingProductTurnIds.map((productTurnId) => [
          productTurnId,
          conversationShareTurnFingerprint(requestRows, productTurnId, workspacePath, {
            workspaceKey: workspaceIdentity?.trim() || workspacePath,
            remoteSessionId: remoteSessionId ?? "",
            sessionId,
            revision: result.revision,
            logEpoch: result.logEpoch,
            capabilitiesFingerprint: result.capabilitiesFingerprint,
          }),
        ]),
      );
      const entries = buildConversationSharePreflightCacheEntries(
        result,
        missingProductTurnIds,
        resultTurnFingerprints,
      );
      sharePreflightMetaRef.current = {
        revision: result.revision,
        logEpoch: result.logEpoch,
        capabilitiesFingerprint: result.capabilitiesFingerprint,
        supportedArtifactTypes: result.supportedArtifactTypes,
      };
      for (const entry of entries) {
        sharePreflightCacheRef.current.set(sharePreflightCacheKey(entry.productTurnId), entry);
      }
      onUpdated();
    },
    onRejected: (error: unknown) => {
      const details = getConversationShareErrorDetails(error);
      logger.warn("[v4-share] 会话分享预检失败", {
        sessionId,
        turnCount: missingProductTurnIds.length,
        name: details.name,
        kind: details.kind,
        reasonCode: details.reasonCode,
        issueCount: details.issueCount ?? 0,
        message: error instanceof Error ? error.message : String(error),
      });
      if (!isCurrent()) return;
      const issues =
        details.issues && details.issues.length > 0
          ? details.issues
          : [
              {
                code: resolveConversationShareFallbackIssueCode(details),
                scope: "transport" as const,
              },
            ];
      for (const productTurnId of missingProductTurnIds) {
        sharePreflightCacheRef.current.set(sharePreflightCacheKey(productTurnId), {
          productTurnId,
          turnFingerprint: selectedShareTurnFingerprints.get(productTurnId),
          blockingIssues: issues,
          skippableWarnings: [],
          deferredIssues: [],
        });
      }
      onUpdated();
    },
    onError: (error: unknown) => {
      if (!isCurrent()) return;
      for (const productTurnId of missingProductTurnIds) {
        sharePreflightCacheRef.current.set(sharePreflightCacheKey(productTurnId), {
          productTurnId,
          turnFingerprint: selectedShareTurnFingerprints.get(productTurnId),
          blockingIssues: [{ code: "unknown", scope: "transport" }],
          skippableWarnings: [],
          deferredIssues: [],
        });
      }
      onUpdated();
      logger.error("[v4-share] 会话分享预检结果处理异常", {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    },
  };
}
