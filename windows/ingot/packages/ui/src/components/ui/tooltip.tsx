"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/components/lib/utils.js";

const TooltipHoverDelayContext = React.createContext<number | undefined>(undefined);

function TooltipProvider({
  delayDuration = 0,
  alwaysDelay,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider> & { alwaysDelay?: boolean }) {
  const inheritedDelay = React.useContext(TooltipHoverDelayContext);
  return (
    <TooltipHoverDelayContext.Provider
      value={alwaysDelay === undefined ? inheritedDelay : alwaysDelay ? delayDuration : undefined}
    >
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        {...props}
      />
    </TooltipHoverDelayContext.Provider>
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const hoverDelay = React.useContext(TooltipHoverDelayContext);
  const tooltip = <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
  return hoverDelay === undefined ? (
    tooltip
  ) : (
    <TooltipPrimitive.Provider
      delayDuration={hoverDelay}
      skipDelayDuration={0}
      disableHoverableContent
    >
      {tooltip}
    </TooltipPrimitive.Provider>
  );
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  style,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const hoverDelay = React.useContext(TooltipHoverDelayContext);
  const content = (
    <TooltipPrimitive.Content
      data-slot="tooltip-content"
      sideOffset={sideOffset}
      className={cn(
        "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-lg border border-border bg-tooltip px-3 py-1.5 text-ui-sm text-tooltip-foreground has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className,
      )}
      style={hoverDelay === undefined ? style : { ...style, pointerEvents: "none" }}
      {...props}
    >
      {children}
    </TooltipPrimitive.Content>
  );
  return (
    <TooltipPrimitive.Portal>
      {}
      {hoverDelay === undefined ? content : <div className="pointer-events-none">{content}</div>}
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
