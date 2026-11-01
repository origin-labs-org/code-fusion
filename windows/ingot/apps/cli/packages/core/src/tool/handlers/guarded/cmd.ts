import type { CommandWord } from "./word.js";

const CMD_DELETE_BUILTIN = /^(?:rd|rmdir|del|erase)$/i;

export function analyzeCmdCommand(source: string): {
  commands: CommandWord[][];
  unsupported: boolean;
} {
  const commands: CommandWord[][] = [];
  let words: CommandWord[] = [];
  let value = "";
  let start = -1;
  let quote = false;
  let dynamic = false;
  let hasUnquotedGlob = false;
  let skipTarget = false;
  let unsupported = false;
  let invalidSegment = false;
  let blockDepth = 0;
  const flushWord = (end: number) => {
    if (start < 0) return;
    if (!skipTarget) words.push({ value, dynamic, hasUnquotedGlob, start, end });
    skipTarget = false;
    value = "";
    start = -1;
    dynamic = false;
    hasUnquotedGlob = false;
  };
  const flushCommand = (end: number) => {
    flushWord(end);
    if (
      !invalidSegment &&
      blockDepth === 0 &&
      words.length &&
      !/^(?:rem|::)$/i.test(words[0]!.value)
    )
      commands.push(words);
    words = [];
    invalidSegment = blockDepth > 0;
  };
  const splitDeleteSwitch = (index: number) => {
    if (!skipTarget && CMD_DELETE_BUILTIN.test(words[0]?.value ?? value)) {
      flushWord(index);
      start = index;
    }
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (!quote && c === "^") {
      if (start < 0) start = i;
      if (source[i + 1] === undefined || /[\r\n]/.test(source[i + 1]!)) {
        unsupported = true;
        invalidSegment = true;
      } else {
        if (source[i + 1] === "/") splitDeleteSwitch(i);
        value += source[++i];
      }
      continue;
    }
    if (c === '"') {
      if (start < 0) start = i;
      quote = !quote;
      continue;
    }
    if (!quote && /[ \t]/.test(c)) {
      flushWord(i);
      continue;
    }
    if (!quote && /[&|\r\n]/.test(c)) {
      flushCommand(i);
      if (source[i + 1] === c) i++;
      continue;
    }
    if (!quote && /[<>]/.test(c)) {
      if (start >= 0 && /^\d+$/.test(value)) {
        value = "";
        start = -1;
      }
      flushWord(i);
      if (source[i + 1] === c) i++;
      if (source[i + 1] === "&" && /[\d-]/.test(source[i + 2] ?? "")) {
        i += 2;
      } else skipTarget = true;
      continue;
    }
    if (!quote && /[()]/.test(c)) {
      unsupported = true;
      invalidSegment = true;
      blockDepth = c === "(" ? blockDepth + 1 : Math.max(0, blockDepth - 1);
    }
    if (!quote && c === "/") splitDeleteSwitch(i);
    if (start < 0) start = i;
    if (c === "%" || c === "!") dynamic = true;
    if (!quote && /[*?[]/.test(c)) hasUnquotedGlob = true;
    value += c;
    if (!quote && !skipTarget && words.length === 0 && /^(?:rem\s|::)/i.test(source.slice(start))) {
      const newline = source.indexOf("\n", i);
      value = "";
      start = -1;
      i = newline < 0 ? source.length : newline;
    }
  }
  if (quote || (skipTarget && start < 0)) {
    unsupported = true;
    invalidSegment = true;
  }
  flushCommand(source.length);
  return { commands, unsupported };
}
