import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { cn } from "@/components/lib/utils.js";

function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      className={cn(
        "overflow-hidden",
        "data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up data-[state=closed]:[animation-fill-mode:forwards] transition-none duration-300 ease-in-out",
        "data-[state=open]:[&>div]:animate-in data-[state=open]:[&>div]:fade-in-0",
        "data-[state=closed]:[&>div]:animate-out data-[state=closed]:[&>div]:fade-out-0 data-[state=closed]:[&>div]:[animation-fill-mode:forwards]",
        className,
      )}
      {...props}
    >
      <div className="transition-none duration-300 ease-in-out">
        {}
        {}
        {children}
      </div>
    </CollapsiblePrimitive.CollapsibleContent>
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
