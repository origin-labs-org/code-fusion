import {
  DEFAULT_FEEDBACK_TICKET_FRAMEWORK,
  type CfProvider,
  type FeedbackTicketFramework,
} from "@origin-ai/cf-shared";

export function inferFeedbackFrameworkFromAgentProvider(
  _provider: CfProvider | null | undefined,
): FeedbackTicketFramework {
  return DEFAULT_FEEDBACK_TICKET_FRAMEWORK;
}
