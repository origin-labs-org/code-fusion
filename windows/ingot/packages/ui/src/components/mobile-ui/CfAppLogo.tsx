import type { CfAppLogoProps } from "@/components/mobile-ui/contract.js";
import { cn } from "@/components/lib/utils.js";
import appLogoUrl from "@/assets/cf-logo.png";

export function CfAppLogo({ className }: CfAppLogoProps) {
  return (
    <img
      src={appLogoUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-app-logo="cf"
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}
