---
name: social-carousel
description:  / anthology  — 8  auto-scroll snap loop， mask（ /  /  / ）+  +  SVG  + 。 /  / mood reel /  (6-10 )。：" anthology  /  / mood reel /  /  0X "。NOT （ digital-eguide），NOT < 4 ，NOT （）。
visibility: public
mode: template
carrier: fixed-image
scenario: social-content
pattern_source: scroll-gallery.html
source_priority: skill-first
triggers:
  - " anthology "
  - ""
  - "mood reel"
  - ""
  - " 0X "
  - "auto-scroll "
related_patterns: social-card-image-led, digital-eguide
---

# Social Carousel Template

Use this template when the artifact is a **curated multi-card anthology** — 6–10 images that share an editorial identity and want to be experienced in rhythm, not as a list.

Distinct from `digital-eguide/social-carousel.html` (12-frame field-notes guide with 50/50 photo + metadata). This one is **gallery-paced**, no per-card metadata table, sculptural geometric masks.

## Use When

- The user wants to publish a **series / anthology /  / collection** — photography, art direction, branding moments, mood reel.
- Each card carries one image + a short serif title + a volume number ( 0X ).
- The viewing context is browsing / pause / browse — not step-by-step instruction.
- The output is a fixed-image set (HTML-to-image) or an embedded auto-scrolling strip.

## Avoid When

- The content is a tutorial or numbered steps — use `digital-eguide/social-carousel.html` (it has progress + per-step metadata) or `social-card-swiss/`.
- The series is < 4 entries — make individual cards instead.
- The content is text-heavy (quotes, body copy) — gallery rhythm hides text.
- The platform expects discrete swipeable posts (XHS multi-image post) — this is one scrolling strip, not 9 separate posts.

## Required Reading

Read this `SKILL.md` first. Do **not** read `scroll-gallery.html` by default.

Read `scroll-gallery.html` only when you need: the geometric-mask shapes (arch / oval / half-dome / diagonal), the auto-scroll easing values, the seamless-loop double-render trick, or the hover-slowdown behavior. Extract patterns; do not copy the placeholder Songti titles, photo URLs, or class names wholesale.

## Design Strategy

Commit to the anthology spine before designing cards:

- one cover frame role per card (full-bleed, arched, oval, diagonal, masked half-dome)
- a single rotating ornamental SVG mark style (don't mix flower + grid + arrow)
- consistent corner metadata (volume + tag + year, picked once)
- one title font (Songti SC), one meta font (PingFang SC), no third voice

If the cards don't share a visual system, the auto-scroll exposes the inconsistency.

## Layout Bias

Prefer:

- 2:3 or 7:9 portrait per card; mix sparingly, never randomly
- restrained warm palette (creams / terracottas / sage) over white or near-black
- one geometric mask per card, rotated through the set
- ornamental marks small and consistent, in a single accent ink
- continuous slow auto-scroll, pause on hover, infinite loop

Avoid:

- emoji or 3D plastic stickers in corner metadata
- mixing portrait + landscape card aspects randomly
- adding step numbers (this is not a tutorial)
- decorative gradients behind images — the mask is the decoration
-  / neon palettes — the template's identity is editorial / warm

## Platform / Size

A horizontal strip of vertical cards (~ 360×540 each). Designed for embedding on a long page or capturing as a wide image. If the user wants discrete XHS posts, export each card individually.
