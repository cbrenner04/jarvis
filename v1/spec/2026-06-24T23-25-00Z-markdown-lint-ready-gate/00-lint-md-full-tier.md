# Add lint:md to the full ready tier

## Problem

The `full` ready tier gates code (`check:fix:unsafe` → `typecheck` → `test` →
`check`) but never runs `bun run lint:md`, so Markdown violations pass `ready`
and prose conventions rot between reviews.

## Decisions

- `lint:md` joins the **`full`** tier only; `fast` stays `typecheck` → `test`. — fast is the unchanged-tree fast path; adding a corpus lint there would slow every fast gate for no review benefit.
- `lint:md` runs as the last full-tier step, after `check`. — it is a pure check (no auto-fix), so ordering before the fix step `check:fix:unsafe` would buy nothing; last keeps the existing fix→verify ordering intact.
- No retry/serial-recovery wrapper for the lint step. — markdownlint is deterministic; the test-step serial retry exists only for parallel-load test flakes, which lint cannot hit.

## Task checklist

- [ ] Append `{ name: "bun", args: ["run", "lint:md"] }` to the `full` branch of `getReadyCommands` in `scripts/ready.ts`, after the `check` step.
- [ ] Update `v1/test/ready-script.sandbox-unrunnable.test.ts`: the full-tier `toEqual` array, the second `["check:fix:unsafe", "typecheck", "test", "check"]` occurrence in the skips-install test, and the test **title** that names the full-tier steps (else it becomes misleading).
- [ ] Update docs: the ready-tier table in `v1/docs/run-loop.md`, and **both** full-tier step recitations in `v2/docs/v1-behaviors.md` — the review-phase baseline (~line 51) and the ready-pipeline-order claim (~line 400).

Implementer note: the lint globs cover `v1/spec/**/*.md` with no ignore for the active spec dir, so the full tier will lint this spec's own files. Keep them lint-clean or the gate blocks the PR going ready.

## Acceptance criteria

- [ ] `bun run ready` full tier runs `bun run lint:md`; a Markdown lint violation in the in-scope corpus fails the gate with a non-zero exit.
- [ ] The unmodified in-scope corpus passes the full tier (gate is green on `main` at merge).
- [ ] The `fast` tier still runs `typecheck` then `test` only: the fast-tier assertions in `v1/test/ready-script.sandbox-unrunnable.test.ts` stay green (unchanged by this addition).
- [ ] `getReadyCommands("full", …)` lists `lint:md` after `check`, and the tier-list tests in `v1/test/ready-script.sandbox-unrunnable.test.ts` assert this and stay green.

## Documentation updates

- `v1/docs/run-loop.md`: add `lint:md` to the `full` tier row of the ready-tier table.
- `v2/docs/v1-behaviors.md`: add `lint:md` to **both** full-tier step recitations — the review-phase baseline (~line 51) and the ready-pipeline-order claim (~line 400). Edit only the parenthetical step list; leave the "enforced by regression tests" clause intact (changes existing v1 behavior — parity baseline must record it).
