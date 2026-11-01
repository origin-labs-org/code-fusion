import { createContext, useContext, useMemo, type ReactNode } from "react";
import { parseRemoteWorkspaceIdentity, type SourceServerRecord } from "@origin-ai/cf-shared";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";

type SettingsTarget = Partial<
  Pick<WorkspaceTabState, "workspaceIdentity" | "remoteTarget" | "remoteSessionId">
>;
const SettingsMachinesContext = createContext<readonly SourceServerRecord[]>([]);
const SettingsUserScopeContext = createContext<{
  target?: SettingsTarget | null;
  sourceServerId?: string | null;
}>({});

export function SettingsUserScopeProvider({
  target,
  sourceServerId,
  children,
}: {
  target?: SettingsTarget | null;
  sourceServerId?: string | null;
  children?: ReactNode;
}) {
  const value = useMemo(() => ({ target, sourceServerId }), [target, sourceServerId]);
  return (
    <SettingsUserScopeContext.Provider value={value}>{children}</SettingsUserScopeContext.Provider>
  );
}

export function useSettingsUserScope() {
  return useContext(SettingsUserScopeContext);
}

export function SettingsMachinesProvider({
  servers,
  children,
}: {
  servers: readonly SourceServerRecord[];
  children?: ReactNode;
}) {
  return (
    <SettingsMachinesContext.Provider value={servers}>{children}</SettingsMachinesContext.Provider>
  );
}

export function useSettingsMachineLabel() {
  const servers = useContext(SettingsMachinesContext);
  const { intl } = useCfIntl();
  return (target?: SettingsTarget | null, sourceServerId?: string | null) => {
    const parsed = parseRemoteWorkspaceIdentity(target?.workspaceIdentity ?? "");
    const sourceId = sourceServerId ?? parsed?.sourceServerId;
    const remote = Boolean(sourceId || target?.remoteTarget || target?.remoteSessionId || parsed);
    const transport = target?.remoteTarget;
    const name =
      servers.find((server) => server.sourceServerId === sourceId)?.displayName ||
      (transport?.kind === "ssh"
        ? transport.host
        : transport?.kind === "docker"
          ? transport.container
          : transport?.kind === "wsl"
            ? transport.distro
            : transport?.kind === "server"
              ? transport.name
              : undefined) ||
      intl.formatMessage({ id: "settings.machine.unknownRemote" });
    return {
      remote,
      label: intl.formatMessage(
        { id: remote ? "settings.machine.remote" : "settings.machine.local" },
        { name },
      ),
    };
  };
}
