# Repair generated ready-intent body to start with a heading

`jarvis1 intent <seed-file>` stages ready-intent markdown via an LLM split
turn, then deterministically repairs it (`repairIntentFile` in
`v1/src/commands/intent.ts`) before writing to `ready-intents/<slug>.md`. The
LLM sometimes emits a body that repeats `name: <slug>` as the first body line
instead of a `# <Title>` heading, so the written file fails
`MD041/first-line-heading`.

## Decisions

- Enforce the heading deterministically in `repairIntentFile`, not only via
  prompt wording — rules out relying solely on LLM compliance, which is what
  produced this bug.
- Derive the fallback title from the intent's kebab-case `slug` (already
  repaired/validated in the same function) — rules out parsing the seed or
  LLM prose for a title, which may not exist or map cleanly.
- If the first non-blank body line (after frontmatter) is already a `#`
  heading, leave it untouched.
- If the first non-blank body line matches `name:\s*.*`, replace that line
  with the derived `# <Title>` heading — rules out only deleting the line,
  which can leave the body still failing MD041 if nothing else follows.
- If the body has no heading and no duplicate `name:` line (e.g. starts with
  other prose), prepend the derived `# <Title>` heading.
- Also tighten `prompts/intent/split.md` Output rules to state the first body
  line must be a `# <Title>` heading, not a restated `name:` line — reduces
  how often the deterministic repair has to intervene, but the repair is the
  load-bearing fix.

## Acceptance criteria

- [ ] A staged intent file whose body's first line after frontmatter is
      `name: <slug>` is rewritten by `repairIntentFile` to start with a
      `# <Title>` heading derived from the slug.
- [ ] A staged intent file whose body already starts with a `#` heading is
      left unchanged by `repairIntentFile`.
- [ ] `jarvis1 intent <seed-file>` output files in `ready-intents/` pass
      `MD041/first-line-heading`.
- [ ] `v1/test/intent-command.sandbox-unrunnable.test.ts` gains a regression
      test asserting the rewritten heading behavior above.

## Documentation updates

- Update `prompts/intent/split.md` Output rules to require a `# <Title>`
  heading as the first body line, not a restated `name:` line.
