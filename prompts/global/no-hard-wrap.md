---
id: global.no-hard-wrap
behavior: global
kind: fragment
revision: 1
order: 3
---
Do not hard-wrap authored markdown (specs, ready-intents, seeds, docs, PR bodies).
Use one physical line per paragraph and per list item.
Indented continuation lines within a single bullet are fine; do not break bullets or paragraphs at column limits.
Do not split `@mutate` directives or acceptance-criterion checkboxes across physical lines.
