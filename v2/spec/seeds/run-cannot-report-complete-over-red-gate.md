# A run must not report complete over a red gate

`jarvis1 run` exited `criteria-complete (exit code 0)` on a spec whose `test:v2`
suite was failing. The failure was only caught later, by `jarvis1 triage --merge`
running `bun run ready` independently.

## Problem

Observed 2026-07-12 on spec `2026-07-12T14-12-30Z-intent-reviewed-uses-external-worktree`:

- The run ticked every acceptance criterion, flipped the PR ready, and reported
  `exit reason: criteria-complete (exit code 0)`.
- `bun run test:v2` on that exact branch head failed:
  `executeWorkflow review dispatch > retries reviewed-intent landing without
  rerunning review and persists its cause`.
- The failure reproduced in isolation (`bun test <file> -t <name>`), so it was
  not a load flake or ordering artifact.
- `triage --merge` then refused the merge on a red `ready` — correct behavior,
  but the run had already declared success.

An exit code of `0` from `run` is the harness's own claim that the work is done.
If a completion gate can pass (or be skipped) while the suite is red, that claim
is unsound and every downstream consumer — the ready flip, the operator's trust,
`cleanup`'s archival — inherits the lie.

## Scope

- Determine why the completion gate did not fail this run: did it not execute,
  did it run a narrower scope than `triage`'s `bun run ready`, or did it run and
  its red result not block completion? Each is a distinct defect; identify which.
- **A red completion gate must be terminal.** A run whose gate is red must not
  report `criteria-complete`, must not flip the PR ready, and must exit non-zero
  with a named reason.
- The run's gate and `triage --merge`'s gate must be the *same* gate. Two gates
  that can disagree means one of them is decorative.
- Regression coverage: a run whose suite fails must not reach a success exit.

## Decisions

- Do not "fix" this by weakening `triage --merge`. `triage` caught the defect;
  `run` is the surface that lied.
- Ticked acceptance criteria are the agent's claim; a green gate is the harness's
  verification. Completion requires both — criteria alone must never suffice.

## Out of scope

- The specific stale test assertion that was red (already fixed on `main`).
- Flake-retry policy — this was a deterministic failure, not a flake.

## Documentation updates

- `v1/docs/operator-runbook.md` — under "The gate": completion requires a green
  gate, and what a `criteria-complete` exit does and does not prove.
- `v2/docs/v1-behaviors.md` — completion-gate contract.
