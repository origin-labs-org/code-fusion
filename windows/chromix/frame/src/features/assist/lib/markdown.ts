import { Marked, type Token, type TokenizerExtension, type Tokens } from "marked";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong" | "em" | "del"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] }
  /** `after` is the punctuation that follows it, kept on its line. */
  | { kind: "cite"; n: number; after: string }
  | { kind: "break" }
  /** Words that arrived a moment ago; they ink in as they land. */
  | { kind: "fresh"; text: string; key: number };

export type Block =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "heading"; children: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "code"; text: string }
  | { kind: "quote"; children: Block[] }
  | { kind: "rule" };

/** A cite mark, `⟦n⟧`, as Rust writes it into the text. */
const cite: TokenizerExtension = {
  name: "cite",
  level: "inline",
  start: (source) => {
    const at = source.indexOf("⟦");
    return at === -1 ? undefined : at;
  },
  tokenizer(source) {
    const match = /^⟦(\d{1,3})⟧/u.exec(source);
    return match ? { type: "cite", raw: match[0], n: Number(match[1]) } : undefined;
  },
};

const lexer = new Marked({ gfm: true, breaks: false, extensions: [cite] });

const safeHref = (href: string) => /^https?:\/\//iu.test(href.trim());

function inline(tokens: readonly Token[] | undefined): Inline[] {
  const out: Inline[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "strong":
      case "em":
      case "del":
        out.push({ kind: token.type, children: inline((token as Tokens.Strong).tokens) });
        break;
      case "codespan":
        out.push({ kind: "code", text: (token as Tokens.Codespan).text });
        break;
      case "link": {
        const link = token as Tokens.Link;
        const children = inline(link.tokens);
        if (safeHref(link.href)) out.push({ kind: "link", href: link.href.trim(), children });
        else out.push(...children);
        break;
      }
      case "cite":
        out.push({ kind: "cite", n: (token as unknown as { n: number }).n, after: "" });
        break;
      case "br":
        out.push({ kind: "break" });
        break;
      case "text": {
        const text = token as Tokens.Text;
        if (text.tokens?.length) out.push(...inline(text.tokens));
        else out.push({ kind: "text", text: text.text });
        break;
      }
      case "escape":
        out.push({ kind: "text", text: (token as Tokens.Escape).text });
        break;
      case "image":
        out.push({ kind: "text", text: (token as Tokens.Image).text });
        break;
      default:
        // Raw HTML and anything else is shown as the words it is, never markup.
        out.push({ kind: "text", text: token.raw });
    }
  }
  return glue(out);
}

/** A cite never starts a line with the comma after it. */
function glue(nodes: Inline[]): Inline[] {
  nodes.forEach((node, at) => {
    const next = nodes[at + 1];
    if (node.kind !== "cite" || next?.kind !== "text") return;
    const lead = /^[,.;:!?)\]”’]+/u.exec(next.text)?.[0];
    if (!lead) return;
    node.after = lead;
    next.text = next.text.slice(lead.length);
  });
  return nodes.filter((node) => node.kind !== "text" || node.text !== "");
}

function blocks(tokens: readonly Token[]): Block[] {
  const out: Block[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "space":
        break;
      case "paragraph":
        out.push({ kind: "paragraph", children: inline((token as Tokens.Paragraph).tokens) });
        break;
      case "text": {
        const text = token as Tokens.Text;
        out.push({
          kind: "paragraph",
          children: text.tokens ? inline(text.tokens) : [{ kind: "text", text: text.text }],
        });
        break;
      }
      case "heading":
        out.push({ kind: "heading", children: inline((token as Tokens.Heading).tokens) });
        break;
      case "list": {
        const list = token as Tokens.List;
        out.push({
          kind: "list",
          ordered: list.ordered,
          start: typeof list.start === "number" ? list.start : 1,
          items: list.items.map((item) => blocks(item.tokens)),
        });
        break;
      }
      case "code":
        out.push({ kind: "code", text: (token as Tokens.Code).text });
        break;
      case "blockquote":
        out.push({ kind: "quote", children: blocks((token as Tokens.Blockquote).tokens) });
        break;
      case "hr":
        out.push({ kind: "rule" });
        break;
      default:
        if (token.raw.trim())
          out.push({ kind: "paragraph", children: [{ kind: "text", text: token.raw.trim() }] });
    }
  }
  return out;
}

/** A deltas' start, newest last, and how long it was. */
export type Arrival = { at: number; length: number };

/**
 * The reply's markdown as blocks to render. Nothing here becomes HTML: every
 * word reaches the page as text. `arrivals` are the latest deltas of a text
 * still streaming; the words they brought are split off the end so they can
 * ink in.
 */
export function parse(source: string, arrivals: readonly Arrival[] = []): Block[] {
  const tree = blocks(lexer.lexer(source));
  if (arrivals.length) markFresh(tree, arrivals);
  return tree;
}

function lastInlines(tree: Block[]): Inline[] | null {
  const block = tree.at(-1);
  if (!block) return null;
  switch (block.kind) {
    case "paragraph":
    case "heading":
      return block.children;
    case "list":
      return lastInlines(block.items.at(-1) ?? []);
    case "quote":
      return lastInlines(block.children);
    default:
      return null;
  }
}

function markFresh(tree: Block[], arrivals: readonly Arrival[]) {
  let inlines = lastInlines(tree);
  while (inlines) {
    const last = inlines.at(-1);
    if (last?.kind === "text") break;
    inlines = last && "children" in last ? last.children : null;
  }
  const leaf = inlines?.at(-1);
  if (!inlines || leaf?.kind !== "text") return;
  let rest = leaf.text;
  const fresh: Inline[] = [];
  for (let index = arrivals.length - 1; index >= 0 && rest; index--) {
    const arrival = arrivals[index]!;
    const length = Math.min(arrival.length, rest.length);
    fresh.unshift({ kind: "fresh", text: rest.slice(rest.length - length), key: arrival.at });
    rest = rest.slice(0, rest.length - length);
  }
  inlines.splice(
    inlines.length - 1,
    1,
    ...(rest ? [{ kind: "text", text: rest } as const] : []),
    ...fresh,
  );
}
