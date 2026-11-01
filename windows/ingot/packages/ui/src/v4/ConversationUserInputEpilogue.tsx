import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useCfIntl } from "@/i18n/IntlProvider.js";

export function splitUserInputEpilogue(
  text: string,
  epilogueStart: number | undefined,
): { body: string; epilogue?: string } {
  if (epilogueStart === undefined || epilogueStart < 0 || epilogueStart > text.length) {
    return { body: text };
  }
  return { body: text.slice(0, epilogueStart), epilogue: text.slice(epilogueStart) };
}

function trimEpilogueLead(text: string): string {
  return text.replace(/^\s*(?:---[ \t]*\n)?/u, "").trimEnd();
}

export function ConversationUserInputEpilogue({ text }: { text: string }) {
  const { intl } = useCfIntl();
  const [open, setOpen] = useState(false);
  const label = intl.formatMessage({ id: "chat.userInput.epilogue.label" });
  return (
    <div data-v4-user-input-epilogue="true" className="flex min-w-0 flex-col gap-1">
      <button
        aria-expanded={open}
        className="flex items-center gap-1 self-start rounded-md text-ui-xs text-foreground-subtlest transition-colors hover:text-foreground"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? (
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0" />
        )}
        {label}
      </button>
      {open ? (
        <pre
          className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-ui-sm text-foreground-subtle"
          data-v4-user-input-epilogue-body="true"
        >
          {trimEpilogueLead(text)}
        </pre>
      ) : null}
    </div>
  );
}
