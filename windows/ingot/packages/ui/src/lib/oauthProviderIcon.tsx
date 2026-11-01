import type { OAuthProviderId } from "@origin-ai/cf-shared";
import { LogInIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";

export function renderOAuthProviderIcon(_provider: OAuthProviderId, className?: string) {
  return <LogInIcon className={cn("shrink-0", className)} />;
}
