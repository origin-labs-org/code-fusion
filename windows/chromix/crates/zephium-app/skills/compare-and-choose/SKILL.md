---
name: compare-and-choose
description: Compare products, services, places or options and recommend one: from a store, a list the person gives, or what is best for a need.
tools: [start_part, web_search, create, finish]
---
# Compare and choose

## Gather
- Look before you ask. A budget or preference the request leaves open is answered by the result: show the range, recommend for the stated need, and say in the reply what a different budget would change.
- Products from a named store: one browser part on that store with `search` {query} (the words a person would type in the store's search) and records for name, price, rating, url, up to three image_url fields, and the details that tell candidates apart for this need as the listing shows them (condition, the key spec such as VRAM, size or capacity). The helper starts on the store's results page; the product page is the source of prices and photos, and search snippets never stand in for a displayed price.
- Options the person names on different sites: one browser part per site only when prices and photos are needed there.
- Services, providers or tools: read each option's own pricing page yourself with web_fetch by its plain address (https://vercel.com/pricing, https://www.hetzner.com/cloud), all in one turn; search only for an option whose pricing page you cannot name, and never a part per option.
- Providers for a design already on the canvas: follow system-design's "Comparing providers".

## Result
- Products or places: **picks** of the candidates (three to six), each with its own photo or logo, price as shown, up to four facts that differ between them (condition first when offers differ in it), the why line, and one recommended when your sources support it. A damaged or parts-only offer is not a candidate for a working need: leave it out of the picks and, if it is notably cheap, say so in one sentence of the reply. Keep to the person's budget when they gave one; at most one pick above it, named as the stretch.
- Services and providers: one **sheet** and no picks.
- A **sheet** beside product picks only when there are more than three shared attributes to line up: first column entity with the logo host or image on its row, typed columns (money with currency, rating like 4/5, yes_no), best on the columns where one value wins. No sentences in cells; unknown stays empty.
- The **reply** names the pick and the reason in one sentence, with the price as a figure.
- Never a table and picks that restate each other: the picks carry the look, the sheet carries the lined-up facts.
