---
name: intent-draft-emits-heading-not-duplicate-name-line
---

# Intent-draft emits a `#` heading instead of restating `name:` as body text

`jarvis1 intent <seed-file>` writes `ready-intents/<name>.md` whose body starts
with a repeated `name: <slug>` line instead of a `# <Title>` heading, failing
`bun run lint:md` (`MD041/first-line-heading`).

Fix the intent-draft render path so generated ready-intent markdown starts
with a `#` heading derived from the intent, not the frontmatter `name:` key.
Add a regression test asserting generated ready-intent markdown starts with a
`#` heading (or passes `MD041/first-line-heading`).

## Prerequisites
