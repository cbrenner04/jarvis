---
name: intent-emit-lint-md-clean-ready-intents-pinned-autofix
---

# intent fan-out emits lint:md-clean ready-intents (pinned binary, autofix-only)

## Problem

`jarvis intent` fan-out should emit ready-intents that pass `lint:md` with no
operator edits. The first attempt (reverted) broke `main`: it shelled out to
`npx markdownlint-cli2` (non-deterministic resolution — passed its own gate,
then failed 34 `intentCommand` tests on `main` via `MD041`/non-autofixable
flags), and it failed emit on every residual non-autofixable violation, which
pre-empted the frontmatter/name validation errors existing repair tests assert.

## Direction

- Run autofix via the **pinned** binary `lint:md` uses
  (`bun node_modules/markdownlint-cli2/markdownlint-cli2.js`), never `npx`;
  resolve `.markdownlint-cli2.jsonc` from the harness anchor and pass it via
  `--config`. Determinism is the point.
- Emit runs the autofix only. Do not fail emit on every residual non-autofixable
  violation. First confirm whether `MD041`/`MD025`-class rules even fire on
  frontmatter-led intents under the pinned binary+config; if they don't, drop
  the residual-failure path. If kept, it must not pre-empt the existing
  frontmatter/name validation errors tests assert.
- Apply identically on the commit and no-commit (external) staging paths, in the
  shared repair step, before validation and before the rename into
  `ready-intents/`.
- Keep issue references off line-start so autofix does not promote `#NNN` to a
  heading.
- Verify on `main` (not just the run worktree) that `intentCommand` tests stay
  green; the original passed its own gate but broke `main`.

## Prerequisites

- jarvis intent fan-out runs a shared emit-contract repair step over staged intents on both the commit and no-commit paths before validation and the rename into ready-intents/
- the lint:md ready step runs the pinned markdownlint-cli2 binary against .markdownlint-cli2.jsonc
