# Decisions-ledger fragment requires a Markdown bullet list

## Problem

`prompts/plan/decisions-ledger.md` says to record decisions "as a ledger of atomic entries, one per line". Taken literally that yields bare consecutive lines, which Markdown reads as a single soft-wrapped paragraph, so the staged `no-hard-wrap` lint rejects the draft (issue #3949: pipeline `0676c490`, lane `plan-accepts-and-validates-base-flag`, runs `635c94bc` and `11fc404b`).

## Decisions

- The fragment requires a Markdown bullet list (`- entry`), one entry per bullet; rules out keeping "one per line" and repairing drafts with `bun run reflow:md`, which merges bare lines into one paragraph and destroys entry boundaries.
- Atomicity, load-bearing-only, and no-narrative rules stay worded as-is; rules out rewriting the fragment wholesale, which would churn the rendered corpus beyond the lint fix.
- The fragment `revision` bumps.

## Task checklist

- [ ] Rewrite the first line of `prompts/plan/decisions-ledger.md` to require a Markdown bullet list and bump `revision`.
- [ ] Add the render assertion to `shared/prompts/cross-path-render.test.ts`.
- [ ] Add a case to `test/markdownlint-no-hard-wrap.test.ts` linting a representative bullet-list decisions ledger clean.
- [ ] Update `v2/docs/spec-guidance.md`.

## Acceptance criteria

- [ ] A test in `shared/prompts/cross-path-render.test.ts` asserts the rendered `plan.decisions-ledger` body requires a Markdown bullet list (`- entry`) and keeps its atomicity, load-bearing-only, and no-narrative-paragraph guidance; it fails against the pre-change fragment.
- [ ] A test in `test/markdownlint-no-hard-wrap.test.ts` lints a representative bullet-list decisions ledger clean under the `no-hard-wrap` rule.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- `v2/docs/spec-guidance.md` — the decisions ledger is authored as a Markdown bullet list, one entry per bullet.
