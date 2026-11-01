import { useCallback, useEffect, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox.js";
import { XIcon } from "lucide-react";
import { TID_CONFIRM_DIALOG_CONFIRM } from "@origin-ai/cf-shared/test-ids";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
import { cn } from "@/components/lib/utils.js";
import {
  AUTOMATION_CONFIRM_DIALOG_CONTENT_CLASS,
  AUTOMATION_CONFIRM_DIALOG_DESCRIPTION_CLASS,
} from "@/settings/automationConfirmDialogPresentation.js";
import { SourceServerBoundaryDialogContent } from "@/remote/SourceServerBoundaryDialogContent.js";

export function ConfirmDialogHost() {
  const { intl } = useCfIntl();
  const pendingRequest = useConfirmDialogStore((state) => state.pendingRequest);
  const settleConfirmation = useConfirmDialogStore((state) => state.settleConfirmation);

  const settleChoice = useConfirmDialogStore((state) => state.settleChoice);

  const displayedRequestRef = useRef(pendingRequest);
  if (pendingRequest) {
    displayedRequestRef.current = pendingRequest;
  }
  const displayedRequest = pendingRequest ?? displayedRequestRef.current;
  const [checkboxSelection, setCheckboxSelection] = useState<{
    request: typeof displayedRequest;
    checked: boolean;
  }>({ request: undefined, checked: false });
  const open = Boolean(pendingRequest);
  const isAutomationConfirmation = displayedRequest?.presentation === "automation-confirmation";
  const isSourceServerBoundary = displayedRequest?.presentation === "source-server-boundary";
  const confirmLabel =
    displayedRequest?.confirmLabel ?? intl.formatMessage({ id: "common.confirm" });
  const cancelLabel = displayedRequest?.cancelLabel ?? intl.formatMessage({ id: "common.cancel" });
  const compact = displayedRequest?.compact === true;
  const destructive = displayedRequest?.confirmVariant === "destructive";
  const cancelRef = useRef<HTMLButtonElement>(null);
  const requiredAcknowledgement = displayedRequest?.requiredAcknowledgement === true;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !requiredAcknowledgement) {
        settleChoice("dismiss");
      }
    },
    [requiredAcknowledgement, settleChoice],
  );

  const handleConfirm = useCallback(() => {
    settleConfirmation(true);
  }, [settleConfirmation]);

  useEffect(() => {
    if (!open || destructive) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter") {
        return;
      }

      if (
        displayedRequest?.checkbox &&
        event.target instanceof HTMLElement &&
        event.target.closest("button,input")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      settleConfirmation(true);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, destructive, settleConfirmation, displayedRequest]);

  if (isSourceServerBoundary) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          data-confirm-intent={displayedRequest?.intent}
          data-testid="source-server-boundary-dialog"
          showCloseButton={false}
          className="gap-0 overflow-hidden rounded-2xl border-none bg-popover p-0 ring-border shadow-2xl sm:max-w-xl"
        >
          <SourceServerBoundaryDialogContent
            title={displayedRequest?.title}
            description={displayedRequest?.description}
            confirmLabel={confirmLabel}
            onConfirm={handleConfirm}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-confirm-intent={displayedRequest?.intent}
        data-testid={displayedRequest?.testId}
        onOpenAutoFocus={(event) => {
          if (destructive) {
            event.preventDefault();
            cancelRef.current?.focus();
          }
        }}
        showCloseButton={false}
        overlayClassName={
          compact ? "bg-black/20 supports-backdrop-filter:backdrop-blur-[2px]" : undefined
        }
        className={cn(
          "gap-5 rounded-2xl border-none bg-popover/98 p-5 ring-border shadow-2xl",
          isAutomationConfirmation ? AUTOMATION_CONFIRM_DIALOG_CONTENT_CLASS : "sm:max-w-md",
          displayedRequest?.compact && "top-[44%] min-h-[161px] gap-4 sm:max-w-[400px]",
        )}
      >
        <DialogHeader className="gap-2">
          <DialogTitle className="text-ui-lg font-semibold text-foreground">
            {displayedRequest?.title}
          </DialogTitle>
          {displayedRequest?.description ? (
            <DialogDescription
              className={cn(
                "whitespace-pre-line pt-0.5 text-ui-base leading-6 text-foreground-subtle",
                isAutomationConfirmation && AUTOMATION_CONFIRM_DIALOG_DESCRIPTION_CLASS,
              )}
            >
              {displayedRequest.description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter
          className={cn(
            "gap-2 sm:justify-end",
            displayedRequest?.checkbox && "flex-row flex-wrap items-center",
            isAutomationConfirmation && "mt-auto",
          )}
        >
          {displayedRequest?.checkbox ? (
            <label className="mr-auto flex min-w-0 items-center gap-2 text-ui-base text-foreground-subtle">
              <Checkbox
                checked={
                  checkboxSelection.request === displayedRequest && checkboxSelection.checked
                }
                onCheckedChange={(value) => {
                  setCheckboxSelection({ request: displayedRequest, checked: value === true });
                  displayedRequest.checkbox?.onCheckedChange(value === true);
                }}
              />
              {displayedRequest.checkbox.label}
            </label>
          ) : null}
          <div
            className={displayedRequest?.checkbox ? "ml-auto flex items-center gap-2" : "contents"}
          >
            {requiredAcknowledgement ? null : (
              <Button
                type="button"
                ref={cancelRef}
                variant={compact ? "outline" : "secondary"}
                size={"lg"}
                onClick={() => settleConfirmation(false)}
                className={cn(
                  "h-9 gap-3 px-4",
                  displayedRequest?.showKeyboardHints !== false && "justify-between sm:min-w-28",
                )}
              >
                <span>{cancelLabel}</span>
                {displayedRequest?.showKeyboardHints !== false ? (
                  <span className="font-mono text-ui-base text-foreground-subtle">esc</span>
                ) : null}
              </Button>
            )}
            <Button
              type="button"
              autoFocus={!destructive}
              variant={displayedRequest?.confirmVariant ?? "default"}
              size={"lg"}
              data-testid={TID_CONFIRM_DIALOG_CONFIRM}
              onClick={handleConfirm}
              className={cn(
                "h-9 gap-3 px-4",
                displayedRequest?.showKeyboardHints !== false && "justify-between sm:min-w-32",
              )}
            >
              <span>{confirmLabel}</span>
              {!destructive && displayedRequest?.showKeyboardHints !== false ? (
                <span
                  className={
                    displayedRequest?.confirmVariant === "destructive"
                      ? "text-ui-base text-destructive-foreground/60"
                      : "text-ui-base text-primary-foreground/60"
                  }
                >
                  ⏎
                </span>
              ) : null}
            </Button>
          </div>
        </DialogFooter>
        {displayedRequest?.showCloseButton && !requiredAcknowledgement ? (
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={intl.formatMessage({ id: "common.close" })}
              className="absolute right-5 top-5 z-20 text-foreground-subtle hover:bg-surface-hover hover:text-foreground [app-region:no-drag]"
            >
              <XIcon className="size-4" strokeWidth={4 / 3} />
            </Button>
          </DialogClose>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
