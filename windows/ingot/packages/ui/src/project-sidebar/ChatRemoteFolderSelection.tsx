import { useEffect, useRef, useState } from "react";
import { DirectoryBrowser } from "@/DirectoryBrowser.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.js";
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  buildServerRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
  type IProjectService,
  type IRemoteProjectService,
  type ProjectSidebarProps,
  type ProjectTree,
  type RemoteProjectHost,
  type VirtualProject,
} from "@/project-sidebar/contract.js";
import { useProjectDirectory } from "@/project-sidebar/ProjectDirectoryProvider.js";
import { useProjectDirectoryServices } from "@/project-sidebar/useProjectDirectoryServices.js";
import { ProjectEditor } from "@/project-sidebar/ProjectEditor.js";
import { formatProjectError } from "@/project-sidebar/view.js";

export function ChatRemoteFolderSelection({
  request,
  service,
  remoteService,
  onCreateTask,
  onClose,
}: {
  request: { sourceServerId: string; host?: RemoteProjectHost; isCurrent(): boolean };
  service: IProjectService;
  remoteService: IRemoteProjectService;
  onCreateTask: ProjectSidebarProps["onCreateTask"];
  onClose(): void;
}) {
  const { intl } = useCfIntl();
  const management = useOptionalBaseWorkspaceServices()?.sourceServerManagementService;
  const sidebar = useProjectDirectory();
  const hostId = remoteHostIdFromWorkspaceIdentity(
    buildServerRemoteWorkspaceIdentity({ serverId: request.sourceServerId, workspacePath: "/" }),
  )!;
  const directory = useProjectDirectoryServices(service, hostId);
  const alive = useRef(true);
  const flight = useRef(false);
  const admittedHost = useRef(
    request.host ?? sidebar.directory.hosts.find((host) => host.id === hostId),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ path: string; tree: ProjectTree } | null>(null);
  const selected = useRef(selection);
  const [choosingProject, setChoosingProject] = useState(false);
  const projectList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (choosingProject && !busy) projectList.current?.querySelector("button")?.focus();
  }, [choosingProject, busy, selection]);
  const current = () => alive.current && request.isCurrent();
  const assertCurrent = () => {
    if (!current()) throw new Error("project.navigation-cancelled");
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const close = () => {
    alive.current = false;
    onClose();
  };
  const readHost = async (): Promise<RemoteProjectHost | undefined> => {
    const hosts = (await remoteService.readDirectory()).hosts;
    assertCurrent();
    const host = hosts.find((item) => item.id === hostId);
    if (admittedHost.current && host?.membershipId !== admittedHost.current.membershipId)
      throw new Error("remote-project.host-removed");
    if (host) admittedHost.current = host;
    return host;
  };
  const prepareHost = async () => {
    const existing = await readHost();
    if (existing) return existing;
    const snapshot = await management?.getSnapshot();
    assertCurrent();
    const profile = snapshot?.servers.some(
      (source) => source.sourceServerId === request.sourceServerId,
    )
      ? snapshot.profiles.find(
          (profile) =>
            profile.sourceServerId === request.sourceServerId &&
            profile.lifecycleState !== "retired",
        )
      : undefined;
    if (!profile) throw new Error("project.connection-unavailable");
    const host = await remoteService.saveHost({ id: hostId, target: profile.target });
    assertCurrent();
    admittedHost.current = host;
    return host;
  };
  const matches = (project: VirtualProject, path: string) =>
    project.hostId === hostId &&
    !project.deleted &&
    project.roots.length === 1 &&
    (project.directoryMatchPath ?? project.roots[0]?.rootPath) === path;
  const enterProject = async (project: VirtualProject, choice = selected.current) => {
    assertCurrent();
    if (!choice) return;
    const host = await prepareHost();
    const tree = await service.readTree({ hostId, includeDeleted: true });
    assertCurrent();
    const actual = tree.projects.find(
      (item) => item.id === project.id && matches(item, choice.path),
    );
    if (!actual || selected.current !== choice) throw new Error("project.not-found");
    await service.readDirectory({ hostId, path: choice.path });
    await readHost();
    assertCurrent();
    await remoteService.addEntry({
      hostId,
      expectedMembershipId: host.membershipId,
      project: { projectId: actual.id, name: actual.name, roots: actual.roots },
    });
    assertCurrent();
    sidebar.preferences?.prepend(actual);
    await sidebar.refresh();
    assertCurrent();
    await readHost();
    await new Promise<void>((resolve, reject) => {
      onCreateTask({
        projectId: actual.id,
        hostId,
        remoteProjectMembershipId: host.membershipId,
        isCurrent: () => current() && selected.current === choice,
        onComplete: resolve,
        onError: reject,
      });
    });
    if (current()) close();
  };
  const chooseProject = async (project: VirtualProject) => {
    if (flight.current || !current()) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    try {
      await enterProject(project);
    } catch (cause) {
      if (current()) {
        logger.warn("[ChatRemoteFolderSelection] Failed to prepare selected item", {
          hostId,
          projectId: project.id,
          cause,
        });
        setError(formatProjectError(cause, intl.formatMessage));
      }
    } finally {
      flight.current = false;
      if (current()) setBusy(false);
    }
  };
  const confirm = async (path: string) => {
    if (flight.current || !current()) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    try {
      await readHost();
      const validated = await service.readDirectory({ hostId, path });
      assertCurrent();
      const tree = await service.readTree({ hostId, includeDeleted: true });
      assertCurrent();
      const choice = { path: validated.path, tree };
      selected.current = choice;
      setSelection(choice);
      const candidates = tree.projects.filter((project) => matches(project, choice.path));
      if (candidates.length > 1 || (choosingProject && candidates.length === 1))
        setChoosingProject(true);
      else if (candidates.length === 1) await enterProject(candidates[0]!, choice);
      else if (choosingProject)
        setError(intl.formatMessage({ id: "chat.remoteFolder.unresolved" }));
      else if (tree.legacySingleRoot)
        setError(intl.formatMessage({ id: "project.legacyUpgradeRequired" }));
    } catch (cause) {
      if (current()) {
        logger.warn("[ChatRemoteFolderSelection] Failed to prepare directory or item", { hostId, cause });
        setError(formatProjectError(cause, intl.formatMessage));
      }
    } finally {
      flight.current = false;
      if (current()) setBusy(false);
    }
  };
  if (
    selection &&
    !choosingProject &&
    !selection.tree.legacySingleRoot &&
    !selection.tree.projects.some((project) => matches(project, selection.path))
  ) {
    return (
      <ProjectEditor
        project={null}
        isCurrent={current}
        fixedFolder={{
          hostId,
          path: selection.path,
          deviceLabel: sidebar.deviceNames?.get(request.sourceServerId) ?? request.sourceServerId,
        }}
        projects={selection.tree.projects}
        service={service}
        onClose={close}
        onBeforeSave={async () => {
          assertCurrent();
          await readHost();
          await service.readDirectory({ hostId, path: selection.path });
          assertCurrent();
          await prepareHost();
        }}
        onSaved={(project) => enterProject(project, selection)}
      />
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        data-testid="chat-remote-folder"
        className="max-w-xl"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DialogTitle>
          {intl.formatMessage({
            id: choosingProject ? "chat.empty.selectProject" : "directoryBrowser.title",
          })}
        </DialogTitle>
        <DialogDescription className="break-all">
          {sidebar.deviceNames?.get(request.sourceServerId) ?? request.sourceServerId}
        </DialogDescription>
        {choosingProject && selection ? (
          <>
            <p className="break-all font-mono text-ui-sm text-foreground-subtle">
              {selection.path}
            </p>
            <div ref={projectList} className="grid auto-rows-max max-h-72 gap-1 overflow-y-auto">
              {selection.tree.projects
                .filter((project) => matches(project, selection.path))
                .map((project) => (
                  <Button
                    key={project.id}
                    variant="ghost"
                    className="h-auto min-h-12 justify-start whitespace-normal text-left"
                    data-testid="chat-remote-project-pick"
                    data-project-id={project.id}
                    disabled={busy}
                    onClick={() => void chooseProject(project)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block break-words">{project.name}</span>
                      <span className="block break-all font-mono text-ui-sm text-foreground-subtle">
                        {project.id}
                      </span>
                    </span>
                  </Button>
                ))}
            </div>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                selected.current = null;
                setSelection(null);
                setChoosingProject(false);
                setError(null);
              }}
            >
              {intl.formatMessage({ id: "chat.remoteFolder.confirm" })}
            </Button>
            <Button variant="ghost" onClick={close}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
          </>
        ) : (
          <fieldset disabled={busy} className="flex min-h-0 flex-col border-0 p-0">
            <DirectoryBrowser
              embedded
              showSelectionActions
              selecting={busy}
              selectLabel={intl.formatMessage({ id: "chat.remoteFolder.confirm" })}
              services={directory.services}
              onSelect={(path) => void confirm(path)}
              onCancel={close}
              formatError={(cause) => formatProjectError(cause, intl.formatMessage)}
            />
          </fieldset>
        )}
        {busy && choosingProject ? (
          <p role="status">{intl.formatMessage({ id: "common.loading" })}</p>
        ) : null}
        {error ? (
          <p role="alert" className="break-all text-ui-sm text-destructive">
            {error}
          </p>
        ) : null}
        {error && selection ? (
          <Button variant="secondary" disabled={busy} onClick={() => void confirm(selection.path)}>
            {intl.formatMessage({ id: "common.retry" })}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
