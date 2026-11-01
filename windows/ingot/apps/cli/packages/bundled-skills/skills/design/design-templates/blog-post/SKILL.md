---
name: blog-post
description: Long-form Chinese article / blog-post template — two voices: a wildstay-style lifestyle launch piece with editorial grid + oversized display type, and a WeChat--style serif beauty/longform with measured prose and quiet hairlines.
visibility: public
mode: template
carrier: long-form-article
scenario: editorial-content
pattern_source: qiye-wildstay.html, ｜.html
source_priority: skill-first
triggers:
  - ""
  - ""
  - " lifestyle "
  - ""
  - ""
  - "editorial "
---

# Blog Post Template

Use this template for **single-page long-form Chinese articles** — brand stories, lifestyle features, beauty / wellness deep-reads, cultural essays, -style long posts rendered as standalone web pages.

This template ships two variants. Pick before building.

## Variants

### `qiye-wildstay.html` — Lifestyle / brand-launch editorial

- Voice: aspirational, energetic, image-led, asymmetric.
- Use for:  /  /  / , brand-launch features,  with strong photography.
- Distinctive moves: oversized display numerals (date as poster), Helvetica + PingFang stack, grid-scattered title characters, rotated accent bars, pill CTAs.

### `｜.html` — Serif long-read

- Voice: introspective, scholarly, text-first.
- Use for:  /  /  /  / , -style serialized columns.
- Distinctive moves: Songti SC display title + Cormorant Garamond italic English subtitle, blue-grey accent rules, justified body, restrained metadata header.

## Use When

- The artifact is a **scrolling web article**, not a fixed-image card.
- Content is paragraph-led with images, pull-quotes, possibly a few module breaks.
- The user wants  /  /  feel — not a SaaS landing, not a social card.

## Avoid When

- The piece is < 200 words — use a social card instead.
- The content is operational (KPIs, dashboards, schedules, OKRs).
- The output is meant to be exported as one image (use social-card-editorial).
- The user wants a deck (use a `ppt/` template).

## Required Reading

Read this `SKILL.md` first. Then read **only the chosen variant** in full to lift typographic rhythm and section transitions.

Do not mix the two voices in one piece. They embody different reading contracts.

## Design Strategy

Pick the variant from voice, not topic:

- Energy + photography forward → **wildstay**
- Quiet + reasoned + paragraphs → ****

Then decide the spine:

- masthead / metadata strip (issue, date, author, kicker)
- title block (display + sub + dek)
- hero image or hero quote (not both)
- 3–6 body sections with clear hierarchy
- inline images with captions (numbered if many)
- closing / colophon

## Layout Bias

Prefer:

- generous line-height for CJK body (≥ 1.75)
- one display font + one body font, not three
- hairline rules over decorative dividers
- justified or natural ragged-right body — never centered
- captions and metadata in small caps / mono / Latin to break the Chinese rhythm

Avoid:

- emoji decorations inside body copy
- generic blog-card grids ("related posts" tiles)
- background gradients behind body copy
- multi-column body on desktop unless variant explicitly supports it
