---
name: lint-md-does-not-cover-the-v2-surface
---

# `lint:md` lints one file in all of v2, so the full-tier ready gate does not check v2 markdown

`.markdownlint-cli2.jsonc` globs:

```json
["v1/spec/**/*.md", "v1/docs/**/*.md", "reports/**/*.md", "v2/docs/onboarding.md", "README.md", "AGENTS.md"]
```

Every `.md` under `v2/docs/**` except `onboarding.md`, and **all** of `v2/spec/**`, is unlinted.

This got worse, not better, when the gate improved. `v2-ready-gate-runs-full-tier` (#1539) shipped
so the v2 ready gate runs the `full` tier — `check`, `typecheck`, tests, **and `lint:md`**. But
`lint:md` is a no-op over the very surface those runs write to: a v2 implement run's spec tree,
subspec edits, and `v2/docs/` updates all sail through a gate that believes it is linting them.
Every v2 workflow artifact this project produces lands in the blind spot.

It also silently changes what the `workflow-output-ignores-the-seeds-target-dir` misrouting costs:
a spec misrouted from `v1/spec/` to `v2/spec/` doesn't just land in the wrong tree, it stops being
linted at all.

## Decisions

- The globs cover `v2/docs/**/*.md` and `v2/spec/**/*.md`, matching the v1 entries. Rules out the
  single-file `v2/docs/onboarding.md` exception, which reads as an oversight, not a policy.
- Existing `**/completed/**` and `**/verdict-*.md` ignores stay — they already exempt archived and
  generated markdown on both surfaces.
- Fix the resulting violations in the same change. A green `lint:md` is the acceptance criterion;
  landing the glob with a red gate would redden every subsequent run's completion gate.
- Rules out: adding a v2-only relaxed rule set. One house style, both surfaces.

## Prerequisites

- None.

## Out of scope

- The `lint:md` rule set itself (`MD013`, `MD033`, … stay as configured).
- CI's decision not to run `lint:md` at all (`local-gate-green-while-ci-red`).

## Documentation updates

- `v1/docs/operator-runbook.md` § The gate — the bullet listing `lint:md`'s globs currently says
  "**not** `v2/docs/**`"; update once it does.
- `v2/docs/operator-runbook.md` § Gate trust — the full tier now genuinely covers v2 markdown.
