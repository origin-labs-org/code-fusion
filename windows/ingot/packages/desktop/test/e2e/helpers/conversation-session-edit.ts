import {
  TID_CHAT_ASSISTANT_MESSAGE,
  TID_CHAT_MESSAGE_EDIT_BUTTON,
  TID_CHAT_MESSAGE_EDIT_INPUT,
  TID_CHAT_MESSAGE_EDIT_SUBMIT,
  TID_CHAT_USER_MESSAGE,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { clickTestIdByDom } from "./desktop-app.js";

export interface EditButtonSnapshot {
  ariaDisabled: boolean;
  disabled: boolean;
  exists: boolean;
  messageId: string;
  testId: string;
  text: string;
}

type LexicalInputE2EBridge = {
  focus: () => void;
  getText: () => string;
  setText: (text: string) => void;
};

type LexicalInputE2EElement = HTMLElement & {
  __cfLexicalInputE2E?: LexicalInputE2EBridge;
};

export async function waitForEditButtonForUserContaining(
  text: string,
  options: { enabled?: boolean } = {},
): Promise<EditButtonSnapshot> {
  const expectEnabled = options.enabled ?? true;
  let latest: EditButtonSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await getEditButtonForUserContaining(text);
        if (!latest?.exists) {
          return false;
        }
        if (!expectEnabled) {
          return true;
        }
        return !latest.disabled && !latest.ariaDisabled;
      },
      {
        timeout: 30000,
        timeoutMsg: `user message没有出现Available edit 按钮: ${text}`,
      }
    );
  } catch (error) {
    latest = await getEditButtonForUserContaining(text);
    throw new Error(
      `user message没有出现Available edit 按钮: ${text}; latest=${JSON.stringify(latest)}`,
      { cause: error },
    );
  }
  if (!latest) {
    throw new Error(`user edit 按钮在Waiting后仍不存在: ${text}`);
  }
  return latest;
}

async function waitForStableEditButtonForUserContaining(
  text: string,
  options: { enabled?: boolean } = {},
): Promise<EditButtonSnapshot> {
  const expectEnabled = options.enabled ?? true;
  const startedAt = Date.now();
  let latest: EditButtonSnapshot | null = null;
  while (Date.now() - startedAt < 30000) {
    const first = await getEditButtonForUserContaining(text);
    if (
      first?.exists &&
      (!expectEnabled || (!first.disabled && !first.ariaDisabled))
    ) {
      await browser.pause(250);
      const second = await getEditButtonForUserContaining(text);
      if (
        second?.exists &&
        second.messageId === first.messageId &&
        second.testId === first.testId &&
        (!expectEnabled || (!second.disabled && !second.ariaDisabled))
      ) {
        return second;
      }
      latest = second;
    } else {
      latest = first;
    }
    await browser.pause(100);
  }
  throw new Error(
    `user message edit 按钮没有稳定下来: ${text}; latest=${JSON.stringify(latest)}`,
  );
}

export async function clickEditButtonForUserContaining(text: string) {
  const button = await waitForStableEditButtonForUserContaining(text, {
    enabled: true,
  });
  await clickTestIdByDom(button.testId, {
    timeout: 15000,
    timeoutMsg: `user edit 按钮不可点击: ${text}`,
  });
  return button;
}

export async function editUserMessageContaining(
  currentText: string,
  nextText: string,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const button = await clickEditButtonForUserContaining(currentText);
    try {
      await setMessageEditInputText(button.messageId, nextText);
      await clickTestIdByDom(
        testId(TID_CHAT_MESSAGE_EDIT_SUBMIT, button.messageId),
        {
          timeout: 15000,
          timeoutMsg: `user edit Submit按钮不可点击: ${button.messageId}`,
        },
      );
      return button;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !isRetryableEditInputError(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`user edit RetryFailed: ${currentText}`);
}

function isRetryableEditInputError(error: Error) {
  return (
    error.message.includes("input-missing") ||
    error.message.includes("edit 输入框没有显示")
  );
}

export function getEditButtonForUserContaining(
  text: string,
): Promise<EditButtonSnapshot | null> {
  return getEditButtonForMessageContaining(TID_CHAT_USER_MESSAGE, text);
}

export function getEditButtonForAssistantContaining(
  text: string,
): Promise<EditButtonSnapshot | null> {
  return getEditButtonForMessageContaining(TID_CHAT_ASSISTANT_MESSAGE, text);
}

export async function setMessageEditInputText(messageId: string, text: string) {
  const inputTestId = testId(TID_CHAT_MESSAGE_EDIT_INPUT, messageId);
  await setLexicalInputTextByTestId(inputTestId, text);
}

async function setLexicalInputTextByTestId(testIdValue: string, text: string) {
  await browser.waitUntil(
    async () =>
      browser.execute((inputTestId) => {
        return Boolean(document.querySelector(`[data-testid="${inputTestId}"]`));
      }, testIdValue),
    {
      timeout: 15000,
      timeoutMsg: `edit Input框没有出现: ${testIdValue}`,
    },
  );
  const inputElement = await $(`[data-testid="${testIdValue}"]`);
  await inputElement.waitForDisplayed({
    timeout: 15000,
    timeoutMsg: `edit input box is not displayed: ${testIdValue}`,
  });

  await waitForEditInputInitializers(testIdValue);

  let actual = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await replaceContentEditableTextByDom(testIdValue, text);
    actual = result.actual;
    if (result.ok) {
      return;
    }
    await waitForEditInputInitializers(testIdValue);
  }

  throw new Error(
    `edit Input框没有WriteComplete prompt: expected=${text}, actual=${actual}`,
  );
}

function getEditInputDiagnostics(testIdValue: string) {
  return browser.execute((inputTestId) => {
    const input = document.querySelector<HTMLElement>(
      `[data-testid="${inputTestId}"]`,
    );
    const nearby = Array.from(
      document.querySelectorAll<HTMLElement>(
        `[data-testid^="chat-message-edit-input-"]`,
      ),
    ).map((element) => ({
      bridgeAttr: element.getAttribute("data-e2e-lexical-bridge"),
      contentEditable: element.getAttribute("contenteditable"),
      testId: element.getAttribute("data-testid"),
      text: (element.innerText ?? element.textContent ?? "").slice(0, 80),
    }));
    return {
      bridgeAttr: input?.getAttribute("data-e2e-lexical-bridge") ?? null,
      bridgeProperty: Boolean(
        (input as LexicalInputE2EElement | null)?.__cfLexicalInputE2E,
      ),
      contentEditable: input?.getAttribute("contenteditable") ?? null,
      exists: Boolean(input),
      nearby,
      tagName: input?.tagName ?? null,
      text: (input?.innerText ?? input?.textContent ?? "").slice(0, 120),
    };
  }, testIdValue);
}

async function waitForEditInputInitializers(testIdValue: string) {
  await browser.executeAsync((inputTestId, done) => {
    const input = document.querySelector<LexicalInputE2EElement>(
      `[data-testid="${inputTestId}"]`,
    );
    input?.__cfLexicalInputE2E?.focus();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        done(null);
      });
    });
  }, testIdValue);
}

async function replaceContentEditableTextByDom(testIdValue: string, text: string) {
  const result = (await browser.executeAsync(
    (inputTestId, nextText, done) => {
      const input = document.querySelector<LexicalInputE2EElement>(
        `[data-testid="${inputTestId}"]`,
      );
      if (!input) {
        done({ actual: "", ok: false, reason: "input-missing" });
        return;
      }

      const readActualText = () => {
        const latestInput = document.querySelector<LexicalInputE2EElement>(
          `[data-testid="${inputTestId}"]`,
        );
        const latestBridge = latestInput?.__cfLexicalInputE2E;
        return (
          latestBridge?.getText() ??
          latestInput?.innerText ??
          latestInput?.textContent ??
          ""
        )
          .replace(/\u00a0/g, " ")
          .trim();
      };

      const bridge = input.__cfLexicalInputE2E;
      if (bridge) {
        bridge.focus();
        bridge.setText("");
        requestAnimationFrame(() => {
          const latestInput = document.querySelector<LexicalInputE2EElement>(
            `[data-testid="${inputTestId}"]`,
          );
          const latestBridge = latestInput?.__cfLexicalInputE2E;
          if (!latestBridge) {
            done({
              actual: "",
              ok: false,
              reason: "bridge-missing-after-clear",
            });
            return;
          }
          latestBridge.setText(nextText);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const actual = readActualText();
              done({
                actual,
                inserted: true,
                ok: actual === nextText.trim(),
                via: "bridge",
              });
            });
          });
        });
        return;
      }

      input.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand("delete");

      let inserted = true;
      const lines = nextText.split("\n");
      for (const [lineIndex, line] of lines.entries()) {
        inserted = document.execCommand("insertText", false, line) && inserted;
        if (lineIndex < lines.length - 1) {
          inserted = document.execCommand("insertLineBreak") && inserted;
        }
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const actual = readActualText();
          done({ actual, inserted, ok: actual === nextText.trim(), via: "dom" });
        });
      });
    },
    testIdValue,
    text,
  )) as {
    actual: string;
    inserted?: boolean;
    ok: boolean;
    reason?: string;
    via?: "bridge" | "dom";
  };
  if (!result.ok && result.reason === "input-missing") {
    const diagnostics = await getEditInputDiagnostics(testIdValue);
    return {
      ...result,
      actual: `${result.actual}; reason=${result.reason}; diagnostics=${JSON.stringify(diagnostics)}`,
    };
  }
  return result;
}

function getEditButtonForMessageContaining(
  messagePrefix: string,
  text: string,
): Promise<EditButtonSnapshot | null> {
  return browser.execute(
    (targetMessagePrefix, editButtonPrefix, expectedText) => {
      const messages = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-testid^="${targetMessagePrefix}-"]`,
        ),
      );
      const message = messages.find((element) =>
        element.innerText.replace(/\u00a0/g, " ").includes(expectedText),
      );
      const messageId = message?.getAttribute("data-message-id");
      if (!message || !messageId) {
        return null;
      }
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          `[data-testid^="${editButtonPrefix}-"]`,
        ),
      ).find((candidate) => candidate.getAttribute("data-message-id") === messageId);
      const resolvedTestId =
        button?.getAttribute("data-testid") ?? `${editButtonPrefix}-${messageId}`;
      return {
        ariaDisabled: button?.getAttribute("aria-disabled") === "true",
        disabled: button?.disabled ?? false,
        exists: Boolean(button),
        messageId,
        testId: resolvedTestId,
        text: button?.innerText.trim() ?? "",
      };
    },
    messagePrefix,
    TID_CHAT_MESSAGE_EDIT_BUTTON,
    text,
  );
}
