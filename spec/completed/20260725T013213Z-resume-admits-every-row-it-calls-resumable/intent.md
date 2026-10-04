---
name: resume-admits-every-row-it-calls-resumable
---

# `run resume` admits every row that advertises itself resumable

## Problem

Rows advertise `resumable: true` while `run resume` refuses them, so the advertised contract and the
admission guard disagree. Observed 2026-07-25 on spec `20260724T230804Z-tui-limits-terminal-rows-to-one-hour`
(PR #2123):

```console
$ jarvis run log b1d7ba2b…
{"kind":"loop_finished","loopOutcomeKind":"ready_gate_failed","iterationsConsumed":5,"resumable":true}
$ jarvis run resume b1d7ba2b…
terminal_run: Cannot resume a failed run
```

`v2/docs/operator-runbook.md` § Gate trust promises resume works after fixing coverage for
`ready_gate_failed` and `surviving_mutation_failed`; both refusals contradict it.

## Decisions

- `resumable: true` on a row and admission by `run resume` are one contract: a row reporting
  `resumable: true` is admitted. Rules out the observed split where the log says resumable and the
  guard says terminal.
- Assert the agreement across every terminal outcome kind, not just the two observed ones, so a
  future outcome cannot reintroduce the split. Rules out a two-case fix.
- When resume genuinely cannot own a row's recovery, the row must not advertise `resumable: true`, and
  the refusal must name the command that can. Rules out two refusals that each point at the other.
- Out of scope: what resume then *does* for a review-step mutation failure (separate behavior).

## Acceptance criteria

- [ ] A `ready_gate_failed` run reporting `resumable: true` is admitted by `jarvis run resume`; the
      test fails against pre-fix code, which refuses `terminal_run: Cannot resume a failed run`.
- [ ] A test asserts, across every terminal `loopOutcomeKind`, that no row reports `resumable: true`
      while `run resume` refuses it; inverting the admission guard fails it.
- [ ] A non-resumable terminal row (e.g. `ready_flip_failed`) is still refused, and its refusal names
      the command that owns its recovery.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Gate trust and § Known gotchas: correct the resume claims to
  match the row/admission contract.
- `v2/docs/daemon-host.md` — the `resume` RPC row: state that advertised `resumable` and admission
  agree by construction.
