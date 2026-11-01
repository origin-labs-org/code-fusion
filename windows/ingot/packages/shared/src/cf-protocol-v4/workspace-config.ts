import { z } from "zod";

export const workspaceConfigSelectValueSchema = z.object({
  value: z.string(),
  name: z.string(),
  description: z.string().optional(),
  origin: z.enum(["native", "injected"]).optional(),
  modelProviderId: z.string().optional(),
  modelProviderName: z.string().optional(),
  modelThoughtLevels: z.array(z.string()).optional(),
  modelDefaultThoughtLevel: z.string().optional(),
});
export type WorkspaceConfigSelectValue = z.infer<typeof workspaceConfigSelectValueSchema>;

export const workspaceConfigOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  type: z.enum(["select", "boolean"]),
  currentValue: z.union([z.string(), z.boolean()]),
  options: z.array(workspaceConfigSelectValueSchema).optional(),
});
export type WorkspaceConfigOption = z.infer<typeof workspaceConfigOptionSchema>;

export const workspaceSlashCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputHint: z.string().optional(),
  source: z.enum(["builtin", "custom"]).optional(),
});
export type WorkspaceSlashCommand = z.infer<typeof workspaceSlashCommandSchema>;

export const workspaceConfigStateSchema = z.object({
  configOptions: z.array(workspaceConfigOptionSchema),
  slashCommands: z.array(workspaceSlashCommandSchema),
});
export type WorkspaceConfigState = z.infer<typeof workspaceConfigStateSchema>;

export const workspaceConfigSnapshotSchema = z.object({
  protocolVersion: z.literal(1),
  workspaceId: z.string(),
  logEpoch: z.string(),
  config: workspaceConfigStateSchema,
});
export type WorkspaceConfigSnapshot = z.infer<typeof workspaceConfigSnapshotSchema>;

export const workspaceConfigDeltaSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("config.updated"), config: workspaceConfigStateSchema }),
]);
export type WorkspaceConfigDelta = z.infer<typeof workspaceConfigDeltaSchema>;

export function workspaceConfigTopic(workspaceId: string): string {
  return `workspace-config/${workspaceId}`;
}

export function parseWorkspaceConfigTopic(topic: string): string | null {
  if (!topic.startsWith("workspace-config/")) return null;
  const workspaceId = topic.slice("workspace-config/".length);
  return workspaceId.length > 0 ? workspaceId : null;
}
