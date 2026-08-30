# Sweep the hundreds of dead `// @mutate` directives left across the v2 test corpus

## Problem

`retire-mutation-checkpoint-dsl` (brief chain, marked 4/4 complete) removed the checkpoint verifier that processed `// @mutate` directives — a whole-repo grep confirms **no code parses `@mutate`** any more (only the `@mutate-equivalent` escape-hatch prefix, comments, and the prompt authoring rule reference it). But the retirement removed only the *processor*, not the directives already written into the test corpus: **hundreds of dead `// @mutate` directives remain across ~60 v2/src test files** (e.g. `tui-monitor-lines.test.ts` 78, `pipeline-execution.test.ts` 45, `state-store.test.ts` 34, `write-loop.test.ts` 31, `init.test.ts` 36). They are inert comments that mislead readers into thinking a directive-based coverage mechanism is live, and they keep getting copied into new tests by agents (see [[retire-mutate-dsl-from-default-write-step-rules]]).

## Evidence (2026-08-30)

Grep of `v2/src/**/*.test.ts` for `// @mutate` (excluding `@mutate-equivalent`) returns 500+ hits across ~60 files. `grep -rn "@mutate" v2/src shared scripts --include='*.ts' | grep -v '\.test\.'` finds no processor — only the retired-DSL comment (`write-loop-input.ts:12`), the escape-hatch prefix, and prompt rules. Several this-session implements re-emitted dead `@mutate` into new tests, requiring hand-scrubs.

## Decisions

- Mechanically delete every standalone `// @mutate …` directive line from `v2/src/**/*.test.ts` that is not an `@mutate-equivalent` directive, in one sweep. Rules out per-PR piecemeal scrubbing (inconsistent, and the corpus is too large).
- Verify the sweep is coverage-neutral: the directives were already inert, so `bun run test:v2` and `test:integration:v2` must pass unchanged, with identical test counts (inventory-diff before/after). Rules out accidentally deleting live test code.
- Land after (or together with) [[retire-mutate-dsl-from-default-write-step-rules]] so the authoring rule stops re-seeding new dead directives. Rules out sweeping while the source keeps producing them.

## Acceptance criteria

- [ ] No `v2/src/**/*.test.ts` file contains a `// @mutate` directive that is not an `@mutate-equivalent` directive (grep returns zero).
- [ ] `bun run test:v2` and `bun run test:integration:v2` pass with the same test count as before the sweep (inventory-diff recorded).
- [ ] `bun run check` passes (no orphaned blank lines / formatting regressions from the deletions).

## Documentation updates

- `v2/docs/operator-runbook.md` — remove any lingering "Checkpoint `@mutate` verification during the write step" language (stale — that verifier was retired).

## Sequencing

P3 cleanup / prompt-corpus. Cosmetic (dead comments, no behavior), but large and confusing. Pairs with [[retire-mutate-dsl-from-default-write-step-rules]].
