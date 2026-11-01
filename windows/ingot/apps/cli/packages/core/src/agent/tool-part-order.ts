import type { ToolPart } from "@origin-ai/cf-contracts";

export function selectToolPartsForHistory(parts: ToolPart[]): ToolPart[] {
  const latestByCallId = new Map(parts.map((part) => [part.callID, part]));
  const latestParts = parts.filter((part) => latestByCallId.get(part.callID) === part);
  if (latestParts.some((part) => part.declarationIndex === undefined)) {
    return latestParts;
  }
  return latestParts.sort((left, right) => left.declarationIndex! - right.declarationIndex!);
}
