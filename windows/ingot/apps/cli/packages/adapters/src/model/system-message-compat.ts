import {
  modelMessageContentToText,
  type ModelInputMessage,
} from "@origin-ai/cf-contracts";

export function normalizeOpenAiCompatibleSystemMessages(
  messages: readonly ModelInputMessage[],
): ModelInputMessage[] {
  let leadingSystemCount = 0;
  while (messages[leadingSystemCount]?.role === "system") {
    leadingSystemCount += 1;
  }

  if (leadingSystemCount <= 1) {
    return [...messages];
  }

  const leadingSystemMessages = messages.slice(0, leadingSystemCount);
  const lastLeadingSystem = leadingSystemMessages.at(-1);

  return [
    {
      role: "system",
      content: leadingSystemMessages
        .map((message) => modelMessageContentToText(message.content))
        .join(""),
      ...(lastLeadingSystem?.cacheControl
        ? { cacheControl: { ...lastLeadingSystem.cacheControl } }
        : {}),
    },
    ...messages.slice(leadingSystemCount),
  ];
}
