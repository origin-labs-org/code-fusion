import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { BotTopicPreparation } from "@origin-ai/cf-shared";
import type { UserInputRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { BotTopicPreparationList } from "@/v4/BotTopicPreparation.js";
import { ConversationUserInputBubble } from "@/v4/ConversationUserInputBubble.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
const chinese = params.get("locale") === "zh-CN";
document.documentElement.className =
  params.get("theme") === "light" ? "light theme-cf-light" : "dark theme-cf-dark";
const text = chinese ? "Beijing今天天气如何？" : "What is the weather in Beijing today?";
const initial: BotTopicPreparation[] = [
  { messageId: "first", senderName: "莫汝舰", text, status: "preparing" },
  {
    messageId: "waiting",
    senderName: "Long sender name ".repeat(12),
    text: (chinese ? "Supplement：请同时View明天的天气。" : "Also check tomorrow's weather. ").repeat(32),
    status: "waitingStop",
  },
  { messageId: "empty", senderName: "Alice", text: "  ", status: "preparing" },
  {
    messageId: "failed",
    senderName: "Bob",
    text: "file_" + "long".repeat(50),
    status: "failed",
    error: chinese ? "Attachment下载Failed，请Retry。" : "Attachment download failed. Please retry.",
  },
];
function Fixture() {
  const [items, setItems] = useState(initial);
  const [accepted, setAccepted] = useState(false);
  const rows = accepted
    ? ([{ kind: "userInput", botGroupSource: { messageId: "first" } }] as UserInputRow[])
    : [];
  return (
    <CfIntlProvider initialLocale={chinese ? "zh-CN" : "en-US"}>
      <TooltipProvider>
        <main className="min-h-screen bg-background p-6 text-foreground @container/conversation">
          <div className="mx-auto flex max-w-3xl flex-col items-end" data-testid="formal">
            <ConversationUserInputBubble text={text} rowId="formal" />
          </div>
          <div className="mx-auto max-w-3xl">
            <BotTopicPreparationList provider="feishu" items={items} acceptedRows={rows} />
          </div>
          <div className="mt-6 flex flex-wrap gap-4">
            <button onClick={() => setAccepted(true)}>Accept first</button>
            <button
              onClick={() =>
                setItems(
                  items.map((item) =>
                    item.messageId === "waiting"
                      ? { ...item, status: "failed", error: "failed after preparing" }
                      : item,
                  ),
                )
              }
            >
              Fail waiting
            </button>
          </div>
        </main>
      </TooltipProvider>
    </CfIntlProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
