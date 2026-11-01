# Title Shortener (1:1 covers + cross-platform reuse)

A long title that works in a 3:4 XHS card or a 21:9 WeChat cover **does not** work in a 1:1 square. Square covers need a different sentence — shorter, blunter, with one idea hitting the viewer in the first glance. This file is the playbook for generating that second title.

It also applies whenever you reuse one piece of content across multiple platforms: XHS carousel + WeChat cover pair + Lvshu single — each surface has a different attention budget.

## Why a separate title is needed

Tested empirically across the smoke decks:

| Source title (3:4 / 21:9)                                | Squeezed into 1:1 verbatim         | Authored short title    |
| -------------------------------------------------------- | ---------------------------------- | ----------------------- |
| ， 3.4kg                          | overflows at 88px, fights bleed    |  3.4kg          |
|  Skill， AI            | 3-line wrap, looks like a paragraph | AI            |
| ，，                       | 4-line wrap on `.poster.square`     | ，      |
| ，         | overflows even at 80px              | ，   |

The squeezed version reads as a wall of text. The authored short title reads as a poster headline.

## The 5-step extraction

When the user gives you a long title (or you wrote one for the 3:4 cover), derive the 1:1 like this:

**1. Identify the core verb.** Every good poster headline has one. `` / `` / `` / ``. Drop modifiers, drop preambles, drop adjectival noise.

**2. Identify the core object.** What is the verb acting on? `` / `` / `` / ``. Skip qualifiers (`` → ``).

**3. Compress to 4-10 Chinese characters.** That is the readable band for 88-120px type on a 1080×1080 canvas. Outside that band, you either need 2 lines (still OK), 3+ lines (almost certainly wrong), or a typographic stunt (one giant character + meta — see Big Word recipe below).

**4. Drop English unless it carries the verb.** Mixed CJK + Latin at large size is a Swiss/Editorial trick that takes a lot of practice. For 1:1 short titles, prefer pure Chinese. Exceptions: brand names (`AI`, `Mac`, `iOS`), domain terms with no Chinese equivalent (`PPT`, `MCP`).

**5. Add a small subtitle only if needed for disambiguation.** Most 1:1 covers don't need one. If you must add it, use `.kicker` or `.t-meta` size (20-22px mono), never a second `.h-xl`.

## Patterns that work for 1:1 covers

### A · Verb + Object (single line, 4-8 chars)

```
 3.4kg
AI 


```

Use when the verb is concrete and the object is short. The headline does the work alone — no subtitle.

### B · Two-clause cut (comma between, 2 lines)

```
，

```

```
，

```

Use when the title needs a contrast or a setup-payoff. Hard-break at the comma; don't let CJK auto-wrap pick the line. Each line should be ≤ 6 characters.

### C · Big Word (one giant character + meta)

```html
<h1 class="h-hero" style="font-size:520px; line-height:0.86;"></h1>
<p class="t-meta"></p>
```

A single character can carry a cover if it's the conceptual anchor of the piece. Pair it with a 1-line meta in mono. Don't try this with 2 characters — it always looks worse than either 1 or 4+.

### D · Number-led headline

```
↓ 3.4kg

```

```
1+1=3

```

When the numerical fact is the news, lead with it. Editorial uses `.num-mega` (200px) over an 56px serif subtitle; Swiss uses `.num-mega` (200px) over a 22px mono cat.

## Anti-patterns

- **Squeezing the 21:9 title.** Cover the urge to use the same exact sentence. The square needs a separate sentence.
- **Adding ""/""/"" preambles.** Question-form titles are too long for 1:1. Use a declarative form: `` → ` 3.4kg`.
- **Three-line titles.** If your draft wraps to 3 lines on `.poster.square`, shorten the copy — never shrink `.h-hero` below 152px. Three lines collapses into a paragraph.
- **Adding a long subtitle.** A 1:1 cover with a 2-line subtitle reads as a flyer. If the subtitle is essential, you probably picked the wrong recipe — switch to a `.poster.xhs` 3:4 instead.
- **English-only titles when the content is Chinese.** Looks like stock template. Mix only when the English carries the actual headline (e.g. brand launch).

## Sizing on `.poster.square` (1080×1080)

Type scale defaults on square boards:

| Style     | Class       | Default size | Use                                |
| --------- | ----------- | ------------ | ---------------------------------- |
| Editorial | `.h-display`| 110px        | Pattern A or B, 1-2 lines          |
| Editorial | `.h-xl`     |  78px        | Subtitle or secondary headline     |
| Swiss     | `.h-hero`   | 200px        | Pattern A or B, 1-2 lines          |
| Swiss     | `.h-statement` | 160px     | Same role as `.h-hero`, slightly tamer |
| Both      | `.num-mega` | 200px        | Pattern D leading number           |

If a single-line short title is ≤ 4 Chinese chars on Swiss square, you can push `.h-hero` to 240px without overflow.

## Cross-platform pairing

When the same content runs as XHS carousel + WeChat cover pair + Lvshu single:

| Surface              | Title source                                | Length band              |
| -------------------- | ------------------------------------------- | ------------------------ |
| XHS p1 cover (3:4)   | Authored long title (12-30 chars)           | 1-2 lines, ≤ 9 chars/line|
| WeChat 21:9 main     | Authored long title or 80% of it            | 1 line, ≤ 14 chars       |
| WeChat 1:1 square    | Shortened per this file (4-10 chars)        | 1-2 lines, ≤ 6 chars/line|
| Lvshu single (3:4)   | Same as XHS p1 or shortened to 8-12 chars   | 1-2 lines                |

The 1:1 short title is the **shortest** of the family. If you cannot shorten further without losing meaning, the content probably needs a different framing — talk to the user.

## Workflow integration

When a user task includes "" or "WeChat cover", you should:

1. Write the long title for 21:9 first.
2. Apply this file's 5-step extraction to derive the 1:1 short title.
3. Print both in the planning notes before rendering.
4. Render both in the same HTML file, plus a `.pair-preview` section showing them side-by-side.

If the user supplies only one title and asks for the pair, derive the short one yourself and call it out in the response (don't silently swap text — the user needs to confirm the shortening reads right).
