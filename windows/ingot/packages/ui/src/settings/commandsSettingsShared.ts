import {
  CF_AGENT_PROVIDER,
  CF_COMMAND_AGENT_SOURCES,
  type CfProvider,
  type CommandAgentSource,
} from "@origin-ai/cf-shared";

export const COMMAND_AGENT_SOURCES = [
  ...CF_COMMAND_AGENT_SOURCES,
] as const satisfies readonly CommandAgentSource[];

export const COMMAND_AGENT_SOURCE_META: Record<
  CommandAgentSource,
  {
    labelId: string;
    provider: CfProvider;
    pathHint: string;
  }
> = {
  cfAgent: {
    labelId: "settings.commands.source.cfAgent",
    pathHint: "~/.cf/commands",
    provider: CF_AGENT_PROVIDER,
  },
};
