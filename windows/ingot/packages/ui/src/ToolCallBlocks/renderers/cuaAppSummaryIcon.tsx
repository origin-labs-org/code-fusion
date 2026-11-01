import { useEffect, useState, type ReactNode } from "react";
import type { ApplicationIconRequest } from "@origin-ai/cf-shared";
import { cn } from "@/components/lib/utils.js";
import { useToolPresentationCapabilities } from "@/ToolCallBlocks/presentationCapabilities.js";
import { CUA_TOOL_ICON } from "@/ToolCallBlocks/renderers/cuaIcon.js";

export function CuaAppSummaryIcon({
  bundleId,
  fallback,
  iconRequest,
  name,
  className,
}: {
  bundleId?: string;
  
  fallback?: ReactNode;
  iconRequest?: ApplicationIconRequest | string | null;
  name: string;
  className?: "size-4" | "size-5";
}) {
  const platform = useToolPresentationCapabilities();
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIconDataUrl(null);
    const request = iconRequest ?? bundleId;
    if (!request || !platform?.getApplicationIcon) return () => undefined;
    void platform
      .getApplicationIcon(request)
      .then((result) => {
        if (active) setIconDataUrl(result?.iconDataUrl ?? null);
      })
      .catch(() => {
        if (active) setIconDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [bundleId, iconRequest, platform]);

  return iconDataUrl ? (
    <img
      src={iconDataUrl}
      alt={name}
      className={cn(className ?? "size-4", "shrink-0 rounded-sm object-contain")}
    />
  ) : (
    (fallback ?? CUA_TOOL_ICON)
  );
}
