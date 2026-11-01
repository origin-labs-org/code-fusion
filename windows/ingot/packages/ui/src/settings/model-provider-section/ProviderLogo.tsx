import type { ProviderConfigObject } from "@origin-ai/cf-provider";
import { PackageIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/components/lib/utils.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";
import { resolveTheme, type ResolvedTheme } from "@/useTheme.js";

type ProviderLogoRef = NonNullable<ProviderConfigObject["logo"]>;

// Brand policy: no third-party model-provider logos ship in the public surface.
// Every provider renders the generic PackageIcon fallback.
export function resolveBuiltinProviderLogoAsset(
  _logo: ProviderLogoRef | null | undefined,
  _theme: ResolvedTheme,
): string | null {
  return null;
}

export function ProviderLogo({
  logo,
  className,
}: {
  logo?: ProviderLogoRef | null;
  className?: string;
}) {
  const theme = useCfStoreWithDefault((state) => state.theme, "cf-dark");
  const src = resolveBuiltinProviderLogoAsset(logo, resolveTheme(theme));
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return <PackageIcon className={cn("shrink-0", className)} aria-hidden="true" />;
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={cn("shrink-0 object-contain", className)}
      onError={() => setFailedSrc(src)}
    />
  );
}
