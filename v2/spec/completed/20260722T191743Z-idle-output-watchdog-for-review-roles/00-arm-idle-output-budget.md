# 00 - Arm an idle-output budget on review role invocations

## Problem

`invokeReviewRole` (`v2/src/execution/review-role-invocation.ts`) supplies no `idleOutputMs` to
`executeWithQuotaFallback`, so the per-role wall clock (`roleTimeoutMs`, default 600s) is the only
bound: a slow-but-emitting actuator and a hung one both ride to the wall and settle identically.
Shared invocation already kills a silent child and settles `{ kind: "stall" }` when a caller supplies
the budget (`shared/invocation/agents.ts` `armIdleTimer`, pinned by `shared/invocation/agents.test.ts`).

## Decisions

- Default the review-path idle budget to 90_000 ms, matching v1's `DEFAULT_IDLE_OUTPUT_TIMEOUT_MS`;
  rules out inventing a fresh v2 number with no evidence behind it.
- Accept a caller override alongside the default so review executors can tighten it later; the
  default is the only value pinned now.
- Attribute an idle-output kill on the execution the same way `roleTimeout` attributes a wall-clock
  abort (role, agent, model, bound), and keep the two fields separate; rules out reusing
  `roleTimeout` for both, which erases the slow-vs-hung distinction this spec exists to make.
- Leave `stall` as a terminal stop for the binding chain (shared invocation already does not advance
  on stall); rules out stall-driven binding advance, which remains deferred in
  `v2/docs/invocation-liveness.md`.
- Leave the write step's invocation with no idle budget; rules out a global idle bound that would
  kill open-ended `implement` passes with legitimately sparse output.
- Deferred to first consumer: per-role/per-behavior idle budgets — pin when a caller needs them.

## Acceptance criteria

- [x] A review role invocation whose binding keeps emitting output past the idle bound runs to
      completion and is not reported as a failure.
- [x] A review role invocation whose binding goes silent past the idle bound settles
      `invocation_failure` with `failureKind: "stall"`, carrying role/agent/model and the idle bound,
      and is distinct from the wall-clock `failureKind: "timeout"` path.
- [x] New tests in `v2/src/execution/review-role-invocation.test.ts` cover both directions and fail
      against the pre-fix code (which supplies no `idleOutputMs`).
- [x] The write step's invocation still supplies no idle budget; a test asserts the write-loop
      invocation is called without `idleOutputMs`.
- [x] `v2/src/execution/review-role-invocation.test.ts` wall-clock timeout and caller-abort tests
      stay green (existing bounds unchanged by the addition).
- [x] Tests pin every added or modified guard in both directions so inverting any guard fails; where
      a guard suppresses an effect, the negative case proves the effect is absent.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/invocation-liveness.md` — the review path now enforces a concrete stdout/stderr idle
  budget; move it out of "deferred" and state what remains deferred (workspace/marker signals,
  per-profile tables, stall-driven binding advance).
- `v2/docs/workflow-runner.md` — per-role invocation bounds: wall clock plus idle-output budget.
