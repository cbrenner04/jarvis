---
name: intent-lint-md-autofix-rework
---

# intent emit-contract lint:md autofix — rework after revert

## Problem

The first attempt at making `jarvis intent` fan-out emit `lint:md`-clean
ready-intents (PR #555, spec
`v1/spec/2026-06-25T19-45-46Z-intent-generated-ready-intents-pass-lint-md/`)
**broke `main`** and was reverted (PR #561). Two defects:

1. It shelled out to **`npx markdownlint-cli2`** instead of the repo's pinned
   `bun node_modules/markdownlint-cli2/markdownlint-cli2.js`. `npx` resolved
   non-deterministically: the run's own gate passed, but the same code
   deterministically failed 34 `intentCommand` tests once merged to `main`
   (markdownlint flagged `MD041`/non-autofixable on frontmatter-led intent files
   under the `npx`-resolved binary).
2. The emit step **failed on any non-autofixable violation** too aggressively,
   so well-formed intents (and existing repair tests expecting frontmatter
   validation errors) were short-circuited by a markdownlint error instead.

The spec itself is sound; the implementation needs redoing.

## Direction

Re-run the existing spec with these constraints (or re-plan tightening them):

- Use the **pinned** markdownlint-cli2 binary the `lint:md` step uses
  (`bun node_modules/markdownlint-cli2/...`), never `npx` — determinism is the
  whole point.
- Only the autofix should run on emit; do **not** fail emit on every residual
  non-autofixable violation. Reconsider whether `MD041`/`MD025`-class rules even
  fire on frontmatter-led intents under the pinned binary+config; if they don't,
  the residual-failure path may be unnecessary. If kept, it must not pre-empt the
  existing frontmatter/name validation errors that tests assert.
- Verify on `main` (not just the run worktree) that `intentCommand` tests stay
  green — the original passed its own gate but broke main.

## References

- Reverted: PR #555 → revert PR #561.
- Spec (still on main): `v1/spec/2026-06-25T19-45-46Z-intent-generated-ready-intents-pass-lint-md/`.
- Pinned invocation: `package.json` `lint:md` script.
