---
name: lint-md-covers-the-v2-surface
---

# `lint:md` covers the full v2 markdown surface

Extend `.markdownlint-cli2.jsonc` globs to `v2/docs/**/*.md` and `v2/spec/**/*.md`,
replacing the single-file `v2/docs/onboarding.md` entry. The full-tier ready gate
then lints every v2 workflow artifact — spec trees, subspec edits, `v2/docs/`
updates — instead of sailing them through a blind spot.

Existing `**/completed/**` and `**/verdict-*.md` ignores stay. Same house-style rule
set, both surfaces — no v2-only relaxed config.

Fix the resulting violations in the same change so `lint:md` stays green; a red gate
would redden every subsequent run's completion gate.

Docs: `v1/docs/operator-runbook.md` § The gate (drop the "**not** `v2/docs/**`"
caveat) and `v2/docs/operator-runbook.md` § Gate trust (full tier now covers v2
markdown).

## Prerequisites
