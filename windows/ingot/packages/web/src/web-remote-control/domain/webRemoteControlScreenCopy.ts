import type { WebRemoteControlFailure, WebRemoteControlFailureReason } from "@origin-ai/cf-shared";

export type WebRemoteControlScreenLocale = "zh-CN" | "en-US";

export interface WebRemoteControlScreenCopy {
  tone: "danger" | "warning" | "neutral";
  badge: string;
  title: string;
  description: string;
  detailLabel: string;
  nextStepsTitle: string;
  nextSteps: string[];
  action: string;
}

const WEB_REMOTE_CONTROL_SCREEN_COPY = {
  "zh-CN": {
    "device-not-owned": {
      tone: "warning",
      badge: "账Number不匹配",
      title: "该Device不属于Current账Number",
      description: "请使用与电脑端E同的账Number登录。",
      detailLabel: "Failed原因",
      nextStepsTitle: "下一步",
      nextSteps: ["确认电脑端Current登录的账Number。", "切换为E同账Number后Reconnect。"],
      action: "重新连接",
    },
    "session-not-found": {
      tone: "warning",
      badge: "链接Unavailable",
      title: "访Question链接已Invalid",
      description: "这次 Web Remote控制链接已经不存在，通常YesDesktop端重New生成了Two维码。",
      detailLabel: "Relay Back",
      nextStepsTitle: "下一步",
      nextSteps: ["回到Desktop端重New打开 Web Remote控制。", "用手机扫描最NewTwo维码。"],
      action: "重新加载",
    },
    "session-expired": {
      tone: "warning",
      badge: "Session结束",
      title: "本次Remote控制已结束",
      description: "CurrentRemote控制Session已经Expiredor被Desktop端Close。",
      detailLabel: "结束原因",
      nextStepsTitle: "下一步",
      nextSteps: ["在Desktop端重New开启 Web Remote控制。", "用New的链接进入Current workspace。"],
      action: "重新加载",
    },
    "session-conflict": {
      tone: "warning",
      badge: "Device接管",
      title: "已被OtherDevice接管",
      description: "另One台Remote控制Device已经接入，同One时间只能RetainOne个手机控制端。",
      detailLabel: "Relay Back",
      nextStepsTitle: "下一步",
      nextSteps: ["Continue使用New接入的Device。", "如果要用本Device控制，请重New扫描Desktop端Two维码。"],
      action: "重新连接",
    },
    "workspace-closed": {
      tone: "neutral",
      badge: "WorkspaceClose",
      title: "Current workspace已Close",
      description: "Desktop端已经Close了SharedWorkspace，手机端无法Continue访Question这个 workspace。",
      detailLabel: "Desktop端Back",
      nextStepsTitle: "下一步",
      nextSteps: ["在Desktop端重New打开TargetWorkspace。", "重New发From Web Remote控制。"],
      action: "重新加载",
    },
    "desktop-disconnected": {
      tone: "danger",
      badge: "电脑端Offline",
      title: "Desktop端已Offline",
      description: "电脑端已经Disconnect，Current手机Pages不能Continue控制DesktopWorkspace。",
      detailLabel: "Relay Back",
      nextStepsTitle: "下一步",
      nextSteps: ["确认电脑端 CodeFusion 仍在Run并联网。", "在电脑端重New开启 Web Remote控制后再Connect。"],
      action: "重新连接",
    },
    "invalid-mobile-connection": {
      tone: "warning",
      badge: "校验Failed",
      title: "手机Connect已Invalid",
      description: "CurrentPages的Two维码参Count无效，请扫描Desktop端的最NewTwo维码。",
      detailLabel: "Failed原因",
      nextStepsTitle: "下一步",
      nextSteps: ["不要复用OldScreenshotorOld链接。", "回到Desktop端扫描最NewTwo维码。"],
      action: "重新连接",
    },
    "desktop-bootstrap-timeout": {
      tone: "warning",
      badge: "响应超时",
      title: "Desktop端Response timed out",
      description: "手机端已经连上 relay，但Desktop端没有及时BackWorkspaceData。",
      detailLabel: "超时Details",
      nextStepsTitle: "下一步",
      nextSteps: ["确认Desktop端没有休眠or卡在确认弹窗。", "保持电脑and手机NetworkAvailable后Retry。"],
      action: "重试",
    },
    "connection-recovery-timeout": {
      tone: "warning",
      badge: "恢复超时",
      title: "Connect恢复超时",
      description: "手机端Connect没有及时恢复，CurrentPages暂时无法Continue同步Remote控制。",
      detailLabel: "恢复Details",
      nextStepsTitle: "下一步",
      nextSteps: [
        "保持手机NetworkAvailable后Retry。",
        "如果仍无法恢复，再回到Desktop端重New开启 Web Remote控制。",
      ],
      action: "重试",
    },
    "relay-unavailable": {
      tone: "danger",
      badge: "Medium转异常",
      title: "无法Connecting转Service",
      description: "手机端无法稳定Connect Web Remote控制Medium转Service。",
      detailLabel: "ConnectDetails",
      nextStepsTitle: "下一步",
      nextSteps: ["Check手机NetworkYes否可访Questionouter网。", "如果电脑端仍Online，可以LaterRefreshRetry。"],
      action: "重试",
    },
    "unsupported-action": {
      tone: "neutral",
      badge: "暂不支持",
      title: "Current动作暂不支持",
      description: "Web Remote控制只支持访QuestionDesktop端已经打开的Workspace。",
      detailLabel: "限制Description",
      nextStepsTitle: "下一步",
      nextSteps: ["先在Desktop端打开TargetWorkspace。", "再从手机端选择这个Workspace。"],
      action: "重新加载",
    },
    "unexpected-error": {
      tone: "danger",
      badge: "Unknown异常",
      title: "Web Remote控制Failed",
      description: "打开Remote控制Pages时发生了未预期Error。",
      detailLabel: "错误详情",
      nextStepsTitle: "下一步",
      nextSteps: ["RefreshPages再试One次。", "如果仍然Failed，请回到Desktop端重New生成Two维码。"],
      action: "重试",
    },
  },
  "en-US": {
    "device-not-owned": {
      tone: "warning",
      badge: "Account mismatch",
      title: "This device does not belong to this account",
      description: "Sign in with the same account as the computer.",
      detailLabel: "Failure detail",
      nextStepsTitle: "Next steps",
      nextSteps: [
        "Check which account is signed in on the computer.",
        "Switch to the same account and reconnect.",
      ],
      action: "Try Again",
    },
    "session-not-found": {
      tone: "warning",
      badge: "Link unavailable",
      title: "Access Link Expired",
      description:
        "This Web remote control link no longer exists, usually because desktop generated a new QR code.",
      detailLabel: "Relay detail",
      nextStepsTitle: "Next steps",
      nextSteps: ["Open Web remote control again on desktop.", "Scan the latest QR code."],
      action: "Reload",
    },
    "session-expired": {
      tone: "warning",
      badge: "Session ended",
      title: "Remote Control Ended",
      description: "This remote control session expired or was closed from desktop.",
      detailLabel: "Close reason",
      nextStepsTitle: "Next steps",
      nextSteps: [
        "Start Web remote control again on desktop.",
        "Open the workspace from a new link.",
      ],
      action: "Reload",
    },
    "session-conflict": {
      tone: "warning",
      badge: "Device takeover",
      title: "Taken Over By Another Device",
      description:
        "Another remote control device connected and replaced this phone. Only one mobile controller can stay active at a time.",
      detailLabel: "Relay detail",
      nextStepsTitle: "Next steps",
      nextSteps: [
        "Continue on the newer device.",
        "Scan the desktop QR code again to use this phone.",
      ],
      action: "Try Again",
    },
    "workspace-closed": {
      tone: "neutral",
      badge: "Workspace closed",
      title: "Workspace Closed",
      description:
        "The shared workspace was closed on desktop, so this phone can no longer access it.",
      detailLabel: "Desktop detail",
      nextStepsTitle: "Next steps",
      nextSteps: ["Reopen the target workspace on desktop.", "Start Web remote control again."],
      action: "Reload",
    },
    "desktop-disconnected": {
      tone: "danger",
      badge: "Desktop offline",
      title: "Desktop Offline",
      description:
        "The desktop side disconnected. This phone can no longer control the desktop workspace.",
      detailLabel: "Relay detail",
      nextStepsTitle: "What happened",
      nextSteps: [
        "Make sure CodeFusion is still running and online on desktop.",
        "Start Web remote control again from desktop.",
      ],
      action: "Try Again",
    },
    "invalid-mobile-connection": {
      tone: "warning",
      badge: "Invalid connection",
      title: "Mobile Connection Invalid",
      description: "The QR parameters are invalid. Scan the latest desktop QR code.",
      detailLabel: "Failure detail",
      nextStepsTitle: "Next steps",
      nextSteps: [
        "Do not reuse an old screenshot or copied link.",
        "Scan the latest desktop QR code.",
      ],
      action: "Try Again",
    },
    "desktop-bootstrap-timeout": {
      tone: "warning",
      badge: "Timed out",
      title: "Desktop Timed Out",
      description:
        "This phone reached the relay, but desktop did not return workspace data in time.",
      detailLabel: "Timeout detail",
      nextStepsTitle: "Next steps",
      nextSteps: [
        "Check that desktop is not asleep or waiting for confirmation.",
        "Keep both devices online and retry.",
      ],
      action: "Retry",
    },
    "connection-recovery-timeout": {
      tone: "warning",
      badge: "Recovery timed out",
      title: "Connection Recovery Timed Out",
      description:
        "This phone did not recover its remote control connection in time, so the current page cannot keep syncing yet.",
      detailLabel: "Recovery detail",
      nextStepsTitle: "Next steps",
      nextSteps: [
        "Keep the phone network available and retry.",
        "If it still cannot recover, start Web remote control again from desktop.",
      ],
      action: "Retry",
    },
    "relay-unavailable": {
      tone: "danger",
      badge: "Relay unavailable",
      title: "Relay Unavailable",
      description: "This phone cannot maintain a connection to the Web remote control relay.",
      detailLabel: "Connection detail",
      nextStepsTitle: "Next steps",
      nextSteps: ["Check the phone network.", "Refresh later if desktop is still online."],
      action: "Retry",
    },
    "unsupported-action": {
      tone: "neutral",
      badge: "Unsupported",
      title: "Action Not Supported",
      description: "Web remote control can only access workspaces already open on desktop.",
      detailLabel: "Limitation",
      nextStepsTitle: "Next steps",
      nextSteps: [
        "Open the target workspace on desktop first.",
        "Select it from this phone afterward.",
      ],
      action: "Reload",
    },
    "unexpected-error": {
      tone: "danger",
      badge: "Unexpected error",
      title: "Web Remote Control Failed",
      description: "An unexpected error occurred while opening Web remote control.",
      detailLabel: "Error detail",
      nextStepsTitle: "Next steps",
      nextSteps: [
        "Refresh this page once.",
        "If it still fails, generate a new QR code on desktop.",
      ],
      action: "Retry",
    },
  },
} satisfies Record<
  WebRemoteControlScreenLocale,
  Record<Exclude<WebRemoteControlFailureReason, "auth-required">, WebRemoteControlScreenCopy>
>;

export function resolveWebRemoteControlScreenLocale(
  language: string,
): WebRemoteControlScreenLocale {
  return language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function resolveWebRemoteControlScreenCopy(
  failure: WebRemoteControlFailure,
  locale: WebRemoteControlScreenLocale,
): WebRemoteControlScreenCopy {
  const reason = failure.reason === "auth-required" ? "relay-unavailable" : failure.reason;
  return WEB_REMOTE_CONTROL_SCREEN_COPY[locale][reason];
}
