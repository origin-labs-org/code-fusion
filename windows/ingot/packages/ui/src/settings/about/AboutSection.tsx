import { CF_BUILD_TIME, CF_COMMIT, CF_VERSION } from "@origin-ai/cf-shared";
import { CfWordmarkLogo } from "@/components/ui/CfAboutLogo.js";
import { CF_PRODUCT_DOCS_URL } from "@/lib/productDocs.js";
import { cn } from "@/components/lib/utils.js";

const ABOUT_LINKS: Array<{ label: string; url: string }> = [
  { label: "Documentation", url: CF_PRODUCT_DOCS_URL },
  { label: "Discord community", url: "https://discord.gg/z9aBcQXZQ3" },
  { label: "Desktop download", url: "https://cf.z.ai/docs/download" },
];

function detectPlatform(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (ua.includes("Mac OS X")) return "macOS";
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Linux")) return "Linux";
  return "Web";
}

export function AboutSection({ className, version }: { className?: string; version?: string }) {
  const rows: Array<[string, string]> = [
    ["Application", "CodeFusion IDE"],
    ["Version", version ?? CF_VERSION],
    ["Commit", CF_COMMIT === "unknown" ? "local build" : CF_COMMIT.slice(0, 12)],
    ["Build", CF_BUILD_TIME === "unknown" ? "local build" : CF_BUILD_TIME],
    ["Platform", detectPlatform()],
    ["Interface", "Desktop · Web · Terminal (cf)"],
  ];

  return (
    <section
      className={cn("flex flex-col gap-6 py-2", className)}
      data-testid="settings-about-section"
    >
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-surface p-6">
        <CfWordmarkLogo className="h-12 w-auto" />
        <p className="max-w-prose text-ui-base text-foreground-subtle">
          CodeFusion IDE is an AI coding workspace with desktop, browser, and terminal
          interfaces — one agent runtime, one configuration, every surface.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-6">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-3 text-ui-base">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-medium text-foreground-subtlest">{label}</dt>
              <dd className="text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3 className="pb-3 text-ui-lg font-semibold text-foreground">Links</h3>
        <ul className="flex flex-col gap-2 text-ui-base">
          {ABOUT_LINKS.map(({ label, url }) => (
            <li key={label}>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-brand underline-offset-4 hover:underline"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <p className="px-1 text-ui-caption text-foreground-subtlest">
        Maintained by Origin AI. The CodeFusion distribution ships no third-party
        model-provider branding.
      </p>
    </section>
  );
}
