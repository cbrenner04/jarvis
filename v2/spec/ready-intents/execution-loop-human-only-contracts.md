---
name: execution-loop-human-only-contracts
---

# Execution-loop contracts honor wrapped and repositioned human-only criteria

## Problem

`spec.criteria-ticked` (`v2/src/execution/write.ts`) and `implement.already_complete`
(`v2/src/execution/implement-workflow-steps.ts`) already filter on `parseSpec(...).humanOnly`, but
until block-aware classification lands, a wrapped or leading-marker human-only bullet is
misclassified as automated — stranding implement at `contract_miss` or rejecting launch at
`already_complete`.

## Decisions

- Contract code may need no change — both paths already derive `humanOnly` from `parseSpec`; this
  subspec proves the stranding paths unblock once the parser classifies block-aware markers.
- Integration coverage uses a wrapped human-only criterion as the only unchecked item — rules out
  unit-parser-only proof that leaves the stranding paths unexercised.

## Acceptance criteria

- [ ] Regressions in `implement-workflow-steps.test.ts` and `write.test.ts` use a wrapped human-only
      criterion as the only unchecked item: `implement.already_complete` preflight exits, and an
      implement write completes instead of `contract_miss`; both fail against pre-fix parser
      classification.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — human-only markers are matched anywhere in a criterion's whole
  bullet block: any position on any line, not trailing-anchored and not first-line-only.

## Prerequisites

- `parseSpec` assembles each acceptance criterion from its full bullet block (first checklist line plus continuation lines until the next `- [ ]` / `- [x]` or section heading).
- `(Manual)`, `visual inspection only`, and `no automated guard` classify a criterion as human-only when present anywhere in that assembled text (case-insensitive, whole-phrase).
