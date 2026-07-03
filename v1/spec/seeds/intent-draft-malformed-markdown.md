# jarvis1 intent draft produces malformed ready-intent markdown

`jarvis1 intent <seed-file>` generated a `ready-intents/<name>.md` with a
duplicate `name:` line and no top-level heading:

```
---
name: claude-sonnet-5-model-support
---
name: claude-sonnet-5-model-support

Add `claude-sonnet-5` support to the claude agent: ...
```

Existing intent files use frontmatter followed by a `# <Title>` heading (see
any `v1/spec/completed/**/intent.md`), never a repeated `name:` line as body
text. This fails `bun run lint:md` (`MD041/first-line-heading`) — CI on the
draft PR caught it (`Lint markdown` job), so the draft PR was red until
hand-fixed.

Find where `jarvis1 intent` renders the ready-intent body from the
intent-draft pass and fix the template/prompt so it emits a proper `#`
heading instead of restating the frontmatter `name:` as the first body line.
Add a regression test asserting generated ready-intent markdown passes the
same first-line-heading rule (or at minimum starts with a `#` heading).
