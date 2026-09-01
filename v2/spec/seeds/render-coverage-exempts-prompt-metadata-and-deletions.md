---
name: render-coverage-exempts-prompt-metadata-and-deletions
---

# Render-coverage gate demands killing coverage for prompt metadata bumps and pure deletions

## Problem

The diff-derived mutation verifier's render-coverage arm requires a mapped render-observer test to kill a mutation on every changed line of a registered prompt (`prompts/**`). It settles `surviving_mutation_failed` / `missing-render-coverage` when a changed prompt line has no killing observer coverage. But two common prompt edits cannot be covered by content-assertion observer tests:

- **Frontmatter/metadata bumps** — e.g. `revision: 15 → 16`. No behavioral observer test asserts the revision literal, and it shouldn't.
- **Pure deletions** — removing a duplicated/obsolete Rules bullet. An observer test can assert the remaining content appears *exactly once* (which kills a re-add/duplication mutation), but the verifier mutates the *deleted* region / the metadata line and finds no killing test.

So a correct, review-passed prompt dedup strands at publication on `missing-render-coverage` even with a mapped observer entry and AC-mandated exact-once assertions. This blocks every prompt-corpus dedup/simplification implement (the whole prompt-corpus seed line).

## Evidence

`plan-draft-rules-single-source` (#3317, 2026-09-01): removed 4 plan-draft Rules bullets duplicating injected `SPEC_GUIDANCE`, bumped `prompts/plan/draft.md` revision 15→16, added `plan-draft.test.ts` exact-once assertions (`prompt.split(phrase).length - 1 === 1`) per its AC. Harness-review-debated, tests green (32 pass), observer map already maps `prompts/plan/draft.md`. Still stranded `surviving_mutation_failed: missing-render-coverage` at `prompts/plan/draft.md:1`. Hand-published. Same class hand-finished repeatedly this session on prompt changes.

## Decisions

- Render-coverage skips prompt frontmatter/metadata lines (anything above the `---` body delimiter, incl. `revision`, `id`, `behavior`, `placeholders`).
- Render-coverage does not require a killing mutation on lines the diff *deletes* — a deletion has no post-change source line to mutate; coverage for "content must not reappear" is the observer test's exact-once/absence assertion, verified by the observer suite itself, not by a per-line mutation.
- A changed prompt whose only diff is metadata and/or deletions, with its observer entry present and green, passes render-coverage.

## Acceptance criteria

- [ ] A registered-prompt diff that only bumps frontmatter `revision` passes render-coverage (no `missing-render-coverage`) — pinned by a verifier test on a frontmatter-only prompt diff.
- [ ] A registered-prompt diff that only deletes body lines, with a present+green observer entry, passes render-coverage — pinned by a verifier test on a deletion-only prompt diff.
- [ ] A registered-prompt diff that ADDS/CHANGES a body line still requires (and enforces) killing observer coverage — pinned so the exemption does not open a hole for real prompt-behavior changes.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Diff-derived mutation verification — the metadata/deletion exemption.
- `v2/docs/operator-runbook.md` — the `missing-render-coverage` recovery note.
