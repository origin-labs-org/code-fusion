import { Blocks, BookOpen, CalendarClock } from "lucide-react";
import { TID_AUTOMATIONS_OPEN } from "@origin-ai/cf-shared/test-ids";
import type { ProjectSidebarProps } from "@/project-sidebar/contract.js";
import { Button } from "@/components/ui/button.js";
import { NewTaskButtonGroup } from "@/NewTaskButtonGroup.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { WebRemoteControlDeviceHeader } from "@/web-remote-control/WebRemoteControlDeviceHeader.js";

export function ProjectSidebarNavigation({
  props,
  onCreate,
}: {
  props: Pick<
    ProjectSidebarProps,
    | "isWebRemoteControl"
    | "onOpenAutomations"
    | "automationsActive"
    | "onOpenPluginStore"
    | "pluginStoreActive"
    | "onOpenRepoWiki"
    | "repoWikiActive"
    | "webRemoteControlWorkspaceSwitcher"
  >;
  onCreate(): void;
}) {
  const { intl } = useCfIntl();
  const deviceNavigation = props.webRemoteControlWorkspaceSwitcher?.deviceNavigation;
  return (
    <div
      data-testid="sidebar-primary-navigation"
      className={`flex flex-col gap-1 px-2 py-3 ${props.isWebRemoteControl && !deviceNavigation ? "max-md:pt-11" : ""}`}
    >
      {}
      {deviceNavigation ? <WebRemoteControlDeviceHeader navigation={deviceNavigation} /> : null}
      <NewTaskButtonGroup onCreateTask={onCreate} />
      {props.onOpenAutomations ? (
        <Button
          variant="ghost"
          size="lg"
          className={`w-full justify-start gap-2 ${props.automationsActive ? "bg-selected text-foreground" : ""}`}
          aria-pressed={props.automationsActive ?? false}
          data-testid={TID_AUTOMATIONS_OPEN}
          onClick={() => props.onOpenAutomations?.()}
        >
          <CalendarClock className="size-4" />
          {intl.formatMessage({ id: "workspace.openScheduledSettings" })}
        </Button>
      ) : null}
      {props.onOpenRepoWiki ? (
        <Button
          variant="ghost"
          size="lg"
          className={`w-full justify-start gap-2 ${props.repoWikiActive ? "bg-selected text-foreground" : ""}`}
          aria-pressed={props.repoWikiActive ?? false}
          data-testid="repo-wiki-sidebar-open"
          onClick={() => props.onOpenRepoWiki?.()}
        >
          <BookOpen className="size-4" />
          Repo Wiki
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="lg"
        className={`w-full justify-start gap-2 ${props.pluginStoreActive ? "bg-selected text-foreground" : ""}`}
        aria-pressed={props.pluginStoreActive ?? false}
        data-testid="plugin-store-sidebar-open"
        onClick={() => props.onOpenPluginStore?.()}
      >
        <Blocks className="size-4" />
        {intl.formatMessage({ id: "workspace.openPluginsSettings" })}
      </Button>
    </div>
  );
}
