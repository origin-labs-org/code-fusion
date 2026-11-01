import type { CfProvider } from "@origin-ai/cf-shared";
import { CfAboutLogo } from "@/components/ui/CfAboutLogo.js";

export function renderProviderCliIcon(_provider: CfProvider = "glm", className?: string) {
  return <CfAboutLogo className={className} />;
}
