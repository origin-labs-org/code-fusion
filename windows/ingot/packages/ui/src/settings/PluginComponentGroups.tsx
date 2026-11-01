import type { CfPluginComponentKind } from "@origin-ai/cf-shared";
import { cn } from "@/components/lib/utils.js";
import { Badge } from "@/components/ui/badge.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";

export interface PluginComponentDisplayItem {
  name: string;
  description?: string;
}

export interface PluginComponentDisplayGroup {
  kind: CfPluginComponentKind;
  
  count: number;
  items: PluginComponentDisplayItem[];
}

const COMPONENT_BADGE_STYLES: Record<CfPluginComponentKind, string> = {
  agent: "bg-violet-500/15 text-violet-500 dark:text-violet-300",
  command: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  skill: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  hook: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  mcp: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};

const COMPONENT_LABEL_IDS: Record<CfPluginComponentKind, string> = {
  agent: "settings.plugins.detail.component.agent",
  command: "settings.plugins.detail.component.command",
  skill: "settings.plugins.detail.component.skill",
  hook: "settings.plugins.detail.component.hook",
  mcp: "settings.plugins.detail.component.mcp",
};

export function PluginComponentGroups({
  groups,
  className,
}: {
  groups: PluginComponentDisplayGroup[];
  className?: string;
}) {
  const { intl } = useCfIntl();
  return (
    <div className={cn("space-y-3", className)}>
      {groups.map((group) => (
        <div key={group.kind} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge
              className={cn(
                "rounded-md border-transparent px-1.5 font-medium",
                COMPONENT_BADGE_STYLES[group.kind],
              )}
            >
              {intl.formatMessage({ id: COMPONENT_LABEL_IDS[group.kind] })}
            </Badge>
            <span className="text-ui-xs text-foreground-subtle">
              {intl.formatMessage(
                { id: "settings.plugins.detail.items" },
                { count: String(group.count) },
              )}
            </span>
          </div>
          {group.items.length > 0 ? (
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.name} className="min-w-0 rounded-md bg-surface px-2 py-1.5">
                  <div className="truncate font-mono text-ui-xs text-foreground">{item.name}</div>
                  {item.description ? (
                    <div className="mt-0.5 line-clamp-2 text-ui-xs leading-snug text-foreground-subtle">
                      {item.description}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
