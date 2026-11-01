import { ControlShortcutBadge } from "@/ControlShortcutBadge.js";
import { cn } from "@/components/lib/utils.js";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <ControlShortcutBadge
      className={cn("pointer-events-none min-w-4 select-none justify-center gap-1", className)}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
