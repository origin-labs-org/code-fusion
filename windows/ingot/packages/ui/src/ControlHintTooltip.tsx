import { Slot } from "radix-ui";
import {
  cloneElement,
  createContext,
  useContext,
  type ReactElement,
  isValidElement,
  useCallback,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@/components/lib/utils.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { ControlShortcutBadge } from "@/ControlShortcutBadge.js";

interface ControlHintTooltipProps {
  children: ReactNode;
  title: ReactNode;
  description?: string;
  shortcut?: string;
  standalone?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: ComponentProps<typeof TooltipContent>["side"];
  align?: ComponentProps<typeof TooltipContent>["align"];
  sideOffset?: ComponentProps<typeof TooltipContent>["sideOffset"];
  className?: string;
  triggerClassName?: string;
  triggerRef?: Ref<HTMLElement>;
}

type TriggerChildProps = {
  className?: string;
  ref?: Ref<HTMLElement>;
};

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) {
    return;
  }
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  ref.current = value;
}

export function ControlHintTooltip({
  children,
  title,
  description,
  shortcut,
  standalone = false,
  open,
  onOpenChange,
  side = "top",
  align = "center",
  sideOffset = 2,
  className,
  triggerClassName,
  triggerRef,
}: ControlHintTooltipProps) {
  const isTriggerElement = isValidElement<TriggerChildProps>(children);
  const childRef = isTriggerElement ? children.props.ref : undefined;
  const composedTriggerRef = useCallback(
    (value: HTMLElement | null) => {
      setRef(childRef, value);
      setRef(triggerRef, value);
    },
    [childRef, triggerRef],
  );
  const trigger = isTriggerElement ? (
    cloneElement(children, {
      className: cn("shrink-0", children.props.className, triggerClassName),
      ref: composedTriggerRef,
    })
  ) : (
    <span
      ref={triggerRef as Ref<HTMLSpanElement>}
      className={cn("inline-flex shrink-0", triggerClassName)}
    >
      {children}
    </span>
  );

  const tooltip = (
    <Tooltip open={open} onOpenChange={onOpenChange}>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={cn(
          description
            ? "max-w-72 flex-col items-start gap-1.5 px-3 py-2 text-left"
            : "max-w-[min(28rem,calc(100vw-1rem))] items-center gap-2 px-2.5 py-1 text-left has-data-[slot=kbd]:pr-1",
          className,
        )}
      >
        {description ? (
          <div className="flex w-full items-start justify-between gap-3">
            <span className="text-ui-sm font-medium leading-4 text-tooltip-foreground">
              {title}
            </span>
            {shortcut ? <ControlShortcutBadge>{shortcut}</ControlShortcutBadge> : null}
          </div>
        ) : (
          <span className="text-ui-sm font-medium whitespace-pre-line break-words text-tooltip-foreground">
            {title}
          </span>
        )}
        {description ? (
          <span className="max-w-64 text-ui-sm/relaxed text-tooltip-foreground/80">
            {description}
          </span>
        ) : null}
        {!description && shortcut ? <ControlShortcutBadge>{shortcut}</ControlShortcutBadge> : null}
      </TooltipContent>
    </Tooltip>
  );

  return standalone ? <TooltipProvider>{tooltip}</TooltipProvider> : tooltip;
}

const SidebarTooltipContext = createContext(false);

export function SidebarTooltipProvider({ children }: { children: ReactNode }) {
  return (
    <SidebarTooltipContext.Provider value>
      <TooltipProvider
        delayDuration={300}
        skipDelayDuration={0}
        alwaysDelay
        disableHoverableContent
      >
        {children}
      </TooltipProvider>
    </SidebarTooltipContext.Provider>
  );
}

export function SidebarNativeTooltip({
  children,
  ...triggerProps
}: Omit<ComponentProps<typeof Slot.Root>, "children"> & {
  children: ReactElement<{ title?: string; disabled?: boolean; className?: string }>;
}) {
  const inSidebar = useContext(SidebarTooltipContext);
  if (!inSidebar || !children.props.title)
    return <Slot.Root {...triggerProps}>{children}</Slot.Root>;
  const trigger = cloneElement(children, { title: undefined });
  return (
    <ControlHintTooltip
      title={children.props.title}
      triggerClassName={cn("shrink", children.props.className)}
    >
      {}
      {children.props.disabled ? (
        <span className="block min-w-0">
          <Slot.Root {...triggerProps}>{trigger}</Slot.Root>
        </span>
      ) : (
        <Slot.Root {...triggerProps}>{trigger}</Slot.Root>
      )}
    </ControlHintTooltip>
  );
}
