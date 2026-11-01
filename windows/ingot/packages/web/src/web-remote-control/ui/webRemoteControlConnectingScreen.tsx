import { LoaderCircleIcon } from "lucide-react";
import { DevicePlatformIcon } from "@origin-ai/cf-ui/device-platform-icon";
import { WebRemoteControlBrand } from "#src/web-remote-control/ui/webRemoteControlBrand.js";
import type { WebRemoteControlScreenLocale } from "#src/web-remote-control/domain/webRemoteControlScreenCopy.js";
import type { WebRemoteControlTerminalTransportState } from "#src/web-remote-control/contract.js";

export interface WebRemoteControlConnectingDevice {
  name?: string;
  platform?: string;
}

const copyByLocale = {
  "zh-CN": {
    connectingTo: (name: string) => `In progressConnect ${name}`,
    connectingFallback: "In progressConnect电脑",
    steps: ["Connecting转Service", "Device鉴权", "WaitingDesktop端配对", "同步Workspace"],
    stages: {
      connecting: "In progressConnecting转Service…",
      authenticating: "In progress认证Device…",
      waiting: "WaitingDesktop端确认配对…",
      paired: "已配对，In progress加载Workspace…",
      reconnecting: "Connection interrupted，In progressReconnect…",
      suspended: "Pages在Background，Waiting恢复…",
      other: "In progressPreparationRemote控制…",
    },
    reconnectingDescription: "Networkor休眠恢复后会AutoReconnect，请稍候。",
    suspendedDescription: "回到前台后会Automatic recoveryConnect。",
  },
  "en-US": {
    connectingTo: (name: string) => `Connecting to ${name}`,
    connectingFallback: "Connecting to your computer",
    steps: [
      "Connect to relay service",
      "Authenticate device",
      "Wait for desktop pairing",
      "Sync workspace",
    ],
    stages: {
      connecting: "Connecting relay service…",
      authenticating: "Authenticating device…",
      waiting: "Waiting for desktop pairing…",
      paired: "Paired. Loading workspace…",
      reconnecting: "Connection interrupted, reconnecting…",
      suspended: "Page is in background, waiting to recover…",
      other: "Preparing remote control…",
    },
    reconnectingDescription: "Auto-reconnecting after network or wake-up changes.",
    suspendedDescription: "Connection will recover automatically when back in foreground.",
  },
};

const STEP_INDEX: Partial<Record<WebRemoteControlTerminalTransportState, number>> = {
  idle: 0,
  connecting: 0,
  authenticating: 1,
  waiting: 2,
  paired: 3,
};

function resolveStage(
  state: WebRemoteControlTerminalTransportState,
  copy: (typeof copyByLocale)["zh-CN"],
): { label: string; description?: string } {
  switch (state) {
    case "connecting":
    case "authenticating":
    case "waiting":
    case "paired":
      return { label: copy.stages[state] };
    case "reconnecting":
      return { label: copy.stages.reconnecting, description: copy.reconnectingDescription };
    case "suspended":
      return { label: copy.stages.suspended, description: copy.suspendedDescription };
    default:
      return { label: copy.stages.other };
  }
}

export function WebRemoteControlLoadingScreen({
  state,
  locale,
  device,
}: {
  state: WebRemoteControlTerminalTransportState;
  locale: WebRemoteControlScreenLocale;
  device?: WebRemoteControlConnectingDevice;
}) {
  const copy = copyByLocale[locale];
  const stage = resolveStage(state, copy);
  const stepIndex = STEP_INDEX[state];
  const name = device?.name?.trim();
  return (
    <div className="flex h-dvh min-h-dvh w-screen flex-col bg-background px-4 pt-[calc(env(safe-area-inset-top)+12px)] text-foreground">
      <div className="flex h-10 items-center">
        <WebRemoteControlBrand />
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex flex-1 flex-col items-center justify-center pb-24 text-center"
      >
        <span className="flex size-16 items-center justify-center rounded-xl border border-card-border bg-card">
          <DevicePlatformIcon platform={device?.platform} className="size-7" />
        </span>
        <h1 className="mt-5 max-w-full truncate text-ui-lg font-semibold">
          {name ? copy.connectingTo(name) : copy.connectingFallback}
        </h1>
        <p className="mt-2 flex items-center gap-2 text-ui-sm text-foreground-subtle">
          <LoaderCircleIcon aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
          {stage.label}
        </p>
        {stage.description ? (
          <p className="mt-1.5 max-w-xs text-ui-sm text-foreground-subtlest">{stage.description}</p>
        ) : null}
        <ol className="mt-5 flex gap-1.5" aria-label={copy.steps.join(" → ")}>
          {copy.steps.map((step, index) => (
            <li
              key={step}
              aria-current={index === stepIndex ? "step" : undefined}
              data-step-state={
                stepIndex === undefined
                  ? "idle"
                  : index < stepIndex
                    ? "done"
                    : index === stepIndex
                      ? "active"
                      : "pending"
              }
              className={[
                "h-1 w-8 rounded-full",
                stepIndex === undefined || index > stepIndex
                  ? "bg-foreground-subtlest/50"
                  : index === stepIndex
                    ? "animate-pulse bg-foreground/60"
                    : "bg-foreground",
              ].join(" ")}
            >
              <span className="sr-only">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
