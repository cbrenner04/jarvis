# 01 — Write loop over the single step

Wrap `executeWrite` (`v2/src/write.ts`) in a behavior loop that repeats until the
work is done, blocked, or the budget runs out, persisting a run plus per-iteration
attempt rows through the state store (00) so the loop is resumable. Single-step,
foreground; resume reads land in 02. Exercised through injected test bindings
(`v2/src/testing/bindings.ts`).

## Decisions

- The loop calls `executeWrite` once per iteration; the iteration budget is
  per-invocation max iterations (a default constant, overridable by a CLI flag
  mirroring v1 `--max-iterations`), not a durable counter. Rules out a durable
  remaining-iterations column resume would decrement.
- `progress` → loop again, consuming one of `N`; the artifact contract is not
  checked mid-loop. Rules out a mid-loop contract check that blocks on artifacts
  that legitimately don't exist yet.
- `done`/`no-work` → check the artifact-existence contract: pass → terminal
  success; fail → append a `## Blocker` to the spec file and stop. Rules out
  silently re-looping on a failed terminal contract (`contract_miss` is a
  blocker).
- The done contract checks artifact existence only; the loop computes no
  acceptance-criteria diff — `runStep`'s outcome token is the criteria-movement
  signal. Rules out building a spec-checkbox/criteria-diff mechanism in Phase 2.
- `blocked` → stop immediately with a terminal blocked outcome. No human routing
  (Phase 6); here it is just a terminal stop.
- Budget exhausted while still `progress` → soft stop: a distinct resumable
  outcome (v1 max-iterations / exit-5), not a blocker. Rules out emitting a
  blocker on budget exhaustion.
- `invocation_failure` (all agents exhausted / not wired) stays terminal, as
  today.
- Each iteration boundary persists via the store's single transactional
  completion boundary (attempt completion + outcome + checkpoint/attempt-count
  advance).
- Cancellation flows through the existing `AbortSignal` on `runStep`/
  `executeWrite`; the core owns no process-level signal handler. Rules out the
  library grabbing process `SIGINT`/`SIGTERM`.

Deferred to first consumer: criteria-movement as an independent done signal —
pin when a caller needs richer done-detection than the agent's token. Loop-result
surface fields beyond `{ outcome kind, run ID, iterations consumed }` — pin when
a richer host (daemon/TUI) reads them.

This subspec always creates a fresh run per invocation; the create-or-resume
branch is 02.

## Task checklist

- [ ] Add a loop module under `v2/src` (e.g. `write-loop.ts`) wrapping
  `executeWrite`.
- [ ] On start, create a run row (identity + work pointers) via the store.
- [ ] Per iteration: record an attempt start, call `executeWrite`, classify the
  `StepRunResult`, commit the boundary with the outcome.
- [ ] Route outcomes: `progress` loops; `done`/`no-work` checks the contract;
  `blocked` stops; budget exhaustion soft-stops; `invocation_failure` stops.
- [ ] On `contract_miss`, append a `## Blocker` (exact level-2 heading) to the
  spec file and stop.
- [ ] Thread `signal` through to each `executeWrite`.
- [ ] CLI: drive the loop with a per-invocation max-iterations flag (default
  constant) and map loop outcomes to exit codes (success 0; soft-stop, blocker,
  and blocked distinct non-zero).
- [ ] Co-located tests via injected bindings.

## Acceptance criteria

- [x] A loop module in `v2/src` calls `executeWrite` repeatedly until a
  terminal or soft-stop outcome.
- [x] `progress` loops again and consumes one of `N`; the artifact contract is
  not checked on a `progress` iteration (test).
- [x] `done` and `no-work` with a passing artifact contract each end the loop
  successfully (test, both tokens).
- [x] `done`/`no-work` with a failing contract appends a `## Blocker` to the spec
  file and stops with no further iteration (test).
- [x] `blocked` stops immediately with an outcome distinct from `contract_miss`
  (test).
- [x] Budget exhausted while still `progress` yields a soft-stop outcome distinct
  from blocked/blocker and marked resumable (test).
- [x] `invocation_failure` is terminal (test).
- [x] Max iterations is per-invocation with a default and a CLI override; no
  durable remaining-iterations column is read or written.
- [x] Cancellation propagates via the provided `AbortSignal`; the core registers
  no process-level signal handler.
- [x] Each iteration persists through the store's transactional boundary.
- [x] No `v2 -> v1` imports; `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v2/docs/write-behavior.md`: replace "One invocation pass only; no automatic
  retry loop" with the loop, its outcomes, the per-invocation budget, and the
  `contract_miss` → blocker behavior. Cross-link `state-store.md` for persistence.
- `v2/docs/v1-behaviors.md`: no change — additive v2-only code.
