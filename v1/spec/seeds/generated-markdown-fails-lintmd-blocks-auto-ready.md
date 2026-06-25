---
name: generated-markdown-fails-lintmd-blocks-auto-ready
---

# Intent/plan-generated markdown fails the `lint:md` ready gate, blocking auto-ready

## Problem

`lint:md` is now in the full ready tier, but the markdown the harness *itself*
generates (intent ready-intents, plan `index.md`/subspecs) is not lint-clean, so
the post-generation `bun run ready` fails at `lint:md` and the PR is never
auto-readied. The operator then hand-fixes the markdown and re-runs the gate —
exactly the manual step the north star wants eliminated.

Hit repeatedly in one session:

- intent ready-intents: `MD012` (multiple consecutive blank lines after an empty
  `## Prerequisites`), `MD018` (no space after `#` where a wrapped `#499` lands
  at line start) — PRs #509, #511 stuck draft.
- plan `index.md`: `MD034` bare URL (`repo: https://github.com/...`) — PR #512
  stuck draft.

## Direction

Make harness-generated markdown pass `lint:md` without operator intervention.
Options for plan to weigh:

- Run `check:fix`-style markdown autofix (markdownlint `--fix`) on emitted
  intent/plan files before the ready gate, inside the generate step.
- Or tighten the emit/repair contract (the intent emit-contract repair already
  fixes `name:`/`## Prerequisites`; extend it to the common lint rules:
  collapse blank runs, wrap/much bare URLs, fix ATX spacing).
- Confirm whichever path keeps `run-loop.md`'s ready tier authoritative.

## Out of scope

- Relaxing or reordering `lint:md` in the ready tier (settled: last, full tier).

## References

- `v1/scripts/ready.ts` / `lint:md` step; intent emit-contract repair in
  `v1/src/commands/intent.ts`; plan draft writer in `v1/src/modes/plan/`.
- Observed 2026-06-25 (PRs #509, #511, #512 finalized by hand).
