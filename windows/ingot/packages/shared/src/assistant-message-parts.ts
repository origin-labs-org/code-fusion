export type CfAssistantMessagePart =
  | {
      type: "content";
      content: string;
    }
  | {
      type: "thought";
      content: string;
    }
  | {
      type: "tool-call";
      toolId: string;
    };

export function appendAssistantMessagePart(
  parts: readonly CfAssistantMessagePart[] | undefined,
  nextPart: CfAssistantMessagePart,
) {
  const currentParts = parts ?? [];
  const lastPart = currentParts[currentParts.length - 1];

  if (
    lastPart &&
    lastPart.type === nextPart.type &&
    (lastPart.type === "content" || lastPart.type === "thought") &&
    (nextPart.type === "content" || nextPart.type === "thought")
  ) {
    return [
      ...currentParts.slice(0, -1),
      {
        ...lastPart,
        content: lastPart.content + nextPart.content,
      },
    ];
  }

  return [...currentParts, nextPart];
}

export function getLatestAssistantContentPart(parts: readonly CfAssistantMessagePart[]) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type === "content") {
      return part;
    }
  }
  return null;
}

export function getLatestAssistantContentText(parts: readonly CfAssistantMessagePart[]) {
  return getLatestAssistantContentPart(parts)?.content ?? "";
}
