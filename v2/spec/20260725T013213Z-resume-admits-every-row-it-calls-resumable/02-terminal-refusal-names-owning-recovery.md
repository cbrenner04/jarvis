# Terminal refusal names the owning recovery

`run resume` refuses non-resumable rows with `terminal_run: Cannot resume a <status> run` — a status, not a
next step. The operator then has to find the recovery in the runbook (`ready_flip_failed`: fix the PR draft
flip manually and verify with `gh pr view <prNumber> --json isDraft`; `role_timeout` / `role_stalled`:
re-dispatch the same workflow; `agent_blocked` / `contract_miss`: inspect the spec). Row and refusal must
point somewhere, not at each other.

## Decisions

- The refusal message names the recovery documented in `v2/docs` for the row's composed
  `error.reason`; rules out a generic "not resumable" string and rules out inventing a recovery per reason at
  the call site.
- The reason→recovery mapping is exhaustive over `RunOperatorErrorReason` (compile-time exhaustive record),
  so a new reason cannot land with an unnamed recovery; rules out a lookup with a silent generic fallback.
- Where no jarvis command owns the recovery (`ready_flip_failed`), the message names the documented manual
  step; rules out naming a jarvis command that does not perform it.
- Refusal keeps `code: "terminal_run"`; only the message gains the recovery. Rules out a new error code that
  breaks existing clients.

## Tasks

- Add the reason→recovery map beside `composeRunOperatorError` and use it in `terminalResumeBlocked`.
- Regress the refusal text for a `ready_flip_failed` row and one non-finalization refusal.

## Acceptance criteria

- [ ] `jarvis run resume` on a `ready_flip_failed` row is still refused with `code: "terminal_run"`, and the
      message names the documented manual PR-flip fix; a new `v2/src/daemon/daemon-resume.test.ts` case fails
      against pre-fix code, which emits only `Cannot resume a completed run`.
- [ ] A second refusal reason (`agent_blocked`) is refused with its documented recovery named in the message,
      covered by the same suite.
- [ ] The reason→recovery mapping is exhaustive over `RunOperatorErrorReason`: removing a reason's entry
      fails `bun run typecheck`.
- [ ] Inverting the refusal guard fails a test — an admitted row emits no refusal message.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — correct the resume claims to the row/admission contract: a row
  advertising `resumable: true` is admitted, and a refusal names its owning recovery.
- `v2/docs/operator-runbook.md` § Known gotchas — drop or correct any claim that a resumable-looking row must
  be abandoned and re-run.
- `v2/docs/daemon-host.md` — the `resume` RPC row: `terminal_run` refusals name the owning recovery.
