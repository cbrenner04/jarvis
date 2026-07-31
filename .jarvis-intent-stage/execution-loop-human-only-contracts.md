---
name: execution-loop-human-only-contracts
---

# Execution-loop contracts honor wrapped and repositioned human-only criteria

## Problem

`spec.criteria-ticked` (`v2/src/execution/write.ts`) and `implement.already_complete`
(`v2/src/execution/implement-workflow-steps.ts`) both call `parseSpec`, but until block-aware
human-only classification lands, a spec whose only unchecked criterion is a wrapped or
leading-marker human-only bullet still strands implement at `contract_miss` or rejects launch
incorrectly.

## Decisions

- Both contracts derive `humanOnly` solely from `parseSpec` on the worktree spec — rules out
  duplicate marker logic in the execution loop.
- Integration coverage uses a wrapped human-only criterion as the only unchecked item — rules out
  unit-parser-only proof that leaves the stranding paths unexercised.

## Acceptance criteria

- [ ] `implement.already_complete` preflight and the `spec.criteria-ticked` completion contract
      both consume `parseSpec` human-only classification: a spec whose only unchecked criterion is
      a wrapped human-only one exits `implement.already_complete`, and an implement run over the
      same spec completes instead of settling `contract_miss`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — human-only markers are matched anywhere in a criterion's whole
  bullet block: any position on any line, not trailing-anchored and not first-line-only.

## Prerequisites

- `parseSpec` assembles each acceptance criterion from its full bullet block (first checklist line plus continuation lines until the next `- [ ]` / `- [x]` or section heading).
- `(Manual)`, `visual inspection only`, and `no automated guard` classify a criterion as human-only when present anywhere in that assembled text (case-insensitive, whole-phrase).
