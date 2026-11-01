import { cn } from "@/components/lib/utils.js";
import cfLogoUrl from "@/assets/cf-logo.png";
import cfWordmarkLogoUrl from "@/assets/cf-wordmark-logo.png";

/** CodeFusion monogram (interlocking C + F). */
export function CfAboutLogo({ className }: { className?: string }) {
  return (
    <img
      src={cfLogoUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-app-logo="cf"
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}

/** Full CodeFusion lockup: monogram + wordmark. */
export function CfWordmarkLogo({ className }: { className?: string }) {
  return (
    <img
      src={cfWordmarkLogoUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-app-logo="cf-wordmark"
      className={cn("shrink-0 select-none object-contain", className)}
    />
  );
}
