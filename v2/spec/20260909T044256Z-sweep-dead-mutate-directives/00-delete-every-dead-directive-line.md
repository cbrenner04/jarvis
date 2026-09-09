# 00 - Delete every dead directive line

## Problem

`grep -rn '@mutate' v2/src shared scripts --include='*.ts' | grep -v '\.test\.'` finds no processor: only a retired-DSL comment in `write-loop-input.ts`, a TUI comment, the `@mutate-equivalent` prefix, and six directive comments in `shared/structural-test-locator.ts`. The 729 standalone `// @mutate <file> "<old>" -> "<new>"` lines in `v2/**/*.test.ts`, `shared/**/*.test.ts`, and `scripts/*.test.ts` are inert comments that read as a live coverage mechanism and are re-seeded by every implement that copies a neighbour.

## Decisions

- Delete every line matching `^\s*// @mutate\b` that is not `// @mutate-equivalent` from `v2/**/*.test.ts`, `shared/**/*.test.ts`, `scripts/**/*.test.ts`, and the six in `shared/structural-test-locator.ts`, mechanically, in one change; rules out per-PR scrubbing.
- Directive text inside string literals (fixtures for the retired parser's tests, prompt-pin assertions) is untouched: only whole comment lines go; rules out editing test data.
- Coverage-neutral by construction and by measurement: the directives were comments, so `bun run test:v2`, `test:integration:v2`, `test:shared`, and `test:integration:shared` pass with identical per-file test counts before and after (inventory diff recorded in the PR); rules out silently deleting live code.
- Prose that names `@mutate` historically (runbook, audit doc) stays; only guidance that still presents directive-based checkpoint verification as live is removed; rules out rewriting history.

## Tasks

- One script pass over the file set; `bun run check` for formatting fallout (a deleted comment can leave a doubled blank line).
- Record the before/after per-file test-count inventory from `bun test` output in the PR body.
- Sweep the runbook for lingering live-tense `@mutate` checkpoint language.

## Acceptance criteria

- [ ] `grep -rnE '^\s*// @mutate\b' v2 shared scripts --include='*.ts' | grep -v '@mutate-equivalent'` returns zero lines.
- [ ] `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, and `bun run test:integration:shared` pass with the same per-file pass counts as on the pre-sweep base (inventory diff recorded in the PR).
- [ ] `bun run check` and `bun run typecheck` pass.
- [ ] `v2/docs/operator-runbook.md` carries no live-tense description of `@mutate` checkpoint verification.

## Documentation updates

- `v2/docs/operator-runbook.md` — remove any lingering live-tense `@mutate` checkpoint language (historical references stay).
- `v2/docs/test-writing.md` — state that `// @mutate` directives are inert and must not be written; `@mutate-equivalent` remains the only directive the verifier reads.
