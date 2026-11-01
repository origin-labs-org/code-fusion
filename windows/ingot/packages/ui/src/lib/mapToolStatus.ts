
import type { ToolPart } from "../components/ai-elements/tool.js";

const statusMap: Record<string, ToolPart["state"]> = {
  pending: "input-streaming",
  in_progress: "input-available",
  completed: "output-available",
  failed: "output-error",
  stopped: "output-error",
  denied: "output-denied",
};

export function mapToolStatus(status: string): ToolPart["state"] {
  return statusMap[status] ?? "input-streaming";
}
