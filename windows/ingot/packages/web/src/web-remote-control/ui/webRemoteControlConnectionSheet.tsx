import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { WebRemoteControlRelayV2Device } from "@origin-ai/cf-shared/web-remote-relay";
import {
  BottomSheet,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
} from "@origin-ai/cf-ui/bottom-sheet";
import { Button } from "@origin-ai/cf-ui/button";
import { DevicePlatformIcon } from "@origin-ai/cf-ui/device-platform-icon";
import type { WebRemoteControlDeviceGroup } from "#src/web-remote-control/contract.js";
import type { WebRemoteControlScreenLocale } from "#src/web-remote-control/domain/webRemoteControlScreenCopy.js";

const copyByLocale = {
  "zh-CN": {
    unnamed: "UntitledDevice",
    sheetDescription: (count: number) => `这台电脑上有 ${count} 个 CodeFusion Online，选择要Connect的One个`,
    startedAgo: (relative: string) => `${relative}Start`,
    cancel: "取消",
  },
  "en-US": {
    unnamed: "Unnamed device",
    sheetDescription: (count: number) =>
      `${count} CodeFusion instances are online on this computer. Choose one.`,
    startedAgo: (relative: string) => `started ${relative}`,
    cancel: "Cancel",
  },
};

function formatRelativeTime(
  createdAtSeconds: number,
  locale: WebRemoteControlScreenLocale,
  now: number,
): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diffSeconds = Math.round(createdAtSeconds - now / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return format.format(0, "minute");
  if (abs < 3600) return format.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(diffSeconds / 3600), "hour");
  if (abs < 30 * 86_400) return format.format(Math.round(diffSeconds / 86_400), "day");
  return new Date(createdAtSeconds * 1000).toLocaleDateString(locale);
}

export function WebRemoteControlDeviceRow({
  first,
  disabled,
  onClick,
  leading,
  children,
  trailing,
  dimmed,
}: {
  first: boolean;
  disabled: boolean;
  onClick?: () => void;
  leading: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  dimmed?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-3 pl-4 text-left text-foreground outline-none enabled:active:bg-hover focus-visible:bg-hover disabled:cursor-not-allowed"
    >
      <span className={dimmed ? "opacity-55" : undefined}>{leading}</span>
      <span
        className={[
          "flex min-h-16 min-w-0 flex-1 items-center gap-2 py-3 pr-3",
          first ? "" : "border-t border-border",
        ].join(" ")}
      >
        <span className={["min-w-0 flex-1", dimmed ? "opacity-55" : ""].join(" ")}>{children}</span>
        {trailing}
      </span>
    </button>
  );
}

export function WebRemoteControlConnectionList({
  device,
  locale,
  disabled,
  now,
  onSelect,
}: {
  device: WebRemoteControlDeviceGroup;
  locale: WebRemoteControlScreenLocale;
  disabled: boolean;
  now: number;
  onSelect(sid: string): void;
}) {
  const copy = copyByLocale[locale];
  return (
    <ul>
      {device.onlineConnections.map((connection: WebRemoteControlRelayV2Device, index) => (
        <li key={connection.device_sid}>
          <WebRemoteControlDeviceRow
            first={index === 0}
            disabled={disabled}
            onClick={() => onSelect(connection.device_sid)}
            leading={
              <DevicePlatformIcon
                platform={connection.meta.platform?.trim() || device.platform}
                className="size-4 text-foreground-subtle"
              />
            }
            trailing={
              <ChevronRightIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-foreground-subtlest"
              />
            }
          >
            <span className="block truncate text-ui-base font-medium">
              {connection.meta.version?.trim()
                ? `CodeFusion ${connection.meta.version.trim()}`
                : "CodeFusion"}
            </span>
            <span className="mt-0.5 block truncate text-ui-sm text-foreground-subtle">
              {copy.startedAgo(formatRelativeTime(connection.created_at, locale, now))}
              {` · ID ${connection.device_sid.slice(-6)}`}
            </span>
          </WebRemoteControlDeviceRow>
        </li>
      ))}
    </ul>
  );
}

export function WebRemoteControlConnectionSheet({
  device,
  locale,
  disabled,
  now,
  onClose,
  onSelect,
}: {
  device: WebRemoteControlDeviceGroup | undefined;
  locale: WebRemoteControlScreenLocale;
  disabled: boolean;
  now(): number;
  onClose(): void;
  onSelect(sid: string): void;
}) {
  const copy = copyByLocale[locale];
  return (
    <BottomSheet
      open={Boolean(device)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {device ? (
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle>{device.name || copy.unnamed}</BottomSheetTitle>
            <BottomSheetDescription>
              {copy.sheetDescription(device.onlineConnections.length)}
            </BottomSheetDescription>
          </BottomSheetHeader>
          <div className="min-h-0 overflow-y-auto">
            <WebRemoteControlConnectionList
              device={device}
              locale={locale}
              disabled={disabled}
              now={now()}
              onSelect={onSelect}
            />
          </div>
          <div className="px-4 pt-3">
            <BottomSheetClose asChild>
              <Button type="button" variant="outline" className="h-11 w-full rounded-lg">
                {copy.cancel}
              </Button>
            </BottomSheetClose>
          </div>
        </BottomSheetContent>
      ) : null}
    </BottomSheet>
  );
}
