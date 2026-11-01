import { CfAppLogo } from "@origin-ai/cf-ui/app-logo";

export function WebRemoteControlBrand({ className }: { className?: string }) {
  return (
    <span className={["inline-flex items-center gap-2", className].filter(Boolean).join(" ")}>
      <CfAppLogo className="size-5" />
      <span className="text-ui-xs font-medium">CodeFusion</span>
    </span>
  );
}
