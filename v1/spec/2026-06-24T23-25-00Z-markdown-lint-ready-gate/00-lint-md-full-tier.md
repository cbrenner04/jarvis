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
- [ ] Update the tier-list assertions in `v1/test/ready-script.sandbox-unrunnable.test.ts` to expect the new step in the full list and its absence from fast.
- [ ] Update docs: the ready-tier table in `v1/docs/run-loop.md` and the full-tier sequence in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `bun run ready` full tier runs `bun run lint:md`; a Markdown lint violation in the in-scope corpus fails the gate with a non-zero exit.
- [ ] The `fast` tier is unchanged — it runs `typecheck` then `test` only and never runs `lint:md`.
- [ ] `getReadyCommands("full", …)` lists `lint:md` after `check`, and the tier-list tests in `v1/test/ready-script.sandbox-unrunnable.test.ts` assert this and stay green.

## Documentation updates

- `v1/docs/run-loop.md`: add `lint:md` to the `full` tier row of the ready-tier table.
- `v2/docs/v1-behaviors.md`: update the full-tier `ready` sequence entries to include `lint:md` (changes existing v1 behavior — parity baseline must record it).
