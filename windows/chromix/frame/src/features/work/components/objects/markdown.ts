/** A draft's Markdown subset as blocks: paragraphs and lists; inline marks stay in the text. */
export type Block =
  { kind: "paragraph"; lines: string[] } | { kind: "list"; items: string[]; ordered?: boolean };

const BULLET = /^\s*[-*•]\s+/u;
const NUMBER = /^\s*\d{1,3}[.)]\s+/u;

/** Lines that are all bullets or all numbered steps are a list; anything else is a paragraph. */
const run = (lines: string[]): Block =>
  lines.every((line) => BULLET.test(line))
    ? { kind: "list", items: lines.map((line) => line.replace(BULLET, "")) }
    : lines.length > 1 && lines.every((line) => NUMBER.test(line))
      ? { kind: "list", ordered: true, items: lines.map((line) => line.replace(NUMBER, "")) }
      : { kind: "paragraph", lines };

/**
 * Steps a model wrote on one line ("1. Choose… 2. Build… 3. Ship…") are
 * steps, not a sentence: split them only when they count up from one.
 */
function steps(line: string): string[] {
  if (!/^\s*1[.)]\s/u.test(line)) return [line];
  const parts = line.split(/\s+(?=\d{1,3}[.)]\s)/u);
  const counted = parts.every((part, index) => part.startsWith(`${index + 1}`));
  // Each step but the last ends its sentence, so "costs 2. dollars" stays a sentence.
  const ended = parts.slice(0, -1).every((part) => /[.!?;:)]$/u.test(part.trimEnd()));
  return parts.length > 1 && counted && ended ? parts : [line];
}

export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  for (const chunk of markdown.replace(/\r\n?/gu, "\n").split(/\n{2,}/u)) {
    const lines = chunk
      .split("\n")
      .filter((line) => line.trim())
      .flatMap(steps);
    if (lines.length) out.push(run(lines));
  }
  return out;
}

/** A note's Markdown as blocks: its headings too. */
export type NoteBlock = Block | { kind: "heading"; text: string };

export function noteBlocks(markdown: string): NoteBlock[] {
  return blocks(markdown).flatMap((block): NoteBlock[] => {
    if (block.kind !== "paragraph") return [block];
    const out: NoteBlock[] = [];
    let lines: string[] = [];
    for (const line of block.lines) {
      const heading = /^#{1,6}\s+(.*)$/u.exec(line);
      if (!heading) {
        lines.push(line);
        continue;
      }
      if (lines.length) out.push(run(lines));
      lines = [];
      out.push({ kind: "heading", text: heading[1]! });
    }
    if (lines.length) out.push(run(lines));
    return out;
  });
}
