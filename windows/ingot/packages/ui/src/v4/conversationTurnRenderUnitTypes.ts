import type { PluginUiRowPinResolver } from "@/plugin-ui/index.js";
import type { BotTopicPreparation } from "@origin-ai/cf-shared";
import type {
  AssistantTextRow,
  ConversationRow,
  HookInvocationRow,
  SessionPhase,
  TimelineMarkerRow,
  TurnHeaderRow,
  UserInputRow,
  WorkflowLaunchMeta,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type { AssistantWorkRow, ConversationTurnFlowItem } from "@/v4/conversationTurnFlowItems.js";
import type {
  ConversationTurnWorkSegment,
  ConversationTurnWorkStatus,
} from "@/v4/conversationTurnWorkSegments.js";
import type { HighspeedOutputFooterMark } from "@/highspeed/highspeedOutputFooter.js";

export interface ConversationTurnRenderUnit extends HighspeedOutputFooterMark {
  
  topicPreparations?: readonly BotTopicPreparation[];
  key: string;
  turnId: string;
  header?: TurnHeaderRow;
  visibleUserInputs: UserInputRow[];
  assistantWorkRows: AssistantWorkRow[];
  
  assistantHistoryRows: AssistantWorkRow[];
  
  assistantFollowingRows: AssistantWorkRow[];
  assistantTailRows: AssistantWorkRow[];
  
  browserTurnEndRows: AssistantWorkRow[];
  
  hookInvocations: HookInvocationRow[];
  
  assistantTextRows: AssistantTextRow[];
  
  leadingBoundaryRows: TimelineMarkerRow[];
  
  latestAssistantTextRow?: AssistantTextRow;
  
  flowItems: ConversationTurnFlowItem[];
  
  workSegments?: ConversationTurnWorkSegment[];
  renderRows: ConversationRow[];
  isLastTurn: boolean;
  isRunning: boolean;
  assistantHistoryDefaultOpen: boolean;
  timelineOnly: boolean;
  
  workStatus?: ConversationTurnWorkStatus;
  startedAt?: number;
  
  workflowLaunch?: WorkflowLaunchMeta;
}

export interface BuildConversationTurnRenderUnitsOptions {
  nowMs?: number;
  sessionPhase?: SessionPhase;
  
  pluginUiPinResolver?: PluginUiRowPinResolver;
}
