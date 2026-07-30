# Resume an exhausted red ready-gate finalization

## Prerequisites

- `terminal-settle-cancels-repair-agent-and-releases-lock` is merged to `main`; rebase this work on its terminal-ownership boundary.

## Problem

An exhausted, non-timeout ready-gate repair already settles its durable run as failed and resumable, but plain `run resume` can re-enter the write path. Gate recovery must resume only the retained completion tail.

## Decisions

- Preserve the existing exhausted-red settlement (`failed` / `ready_gate_failed` / resumable); it is not new work.
- Admit finalization-only resume only for a failed implement completion row whose same-run terminal `loop_finished` evidence records `ready_gate_failed`, `resumable: true`, and a normalized `repair_budget_exhausted` origin after the configured cap of non-timeout `ReadyGateError` repairs.
- Reject same-named failures from a deadline timeout, blocked or unsettled repair, iteration-limit suppression, missing or mismatched terminal lineage, missing retained checkpoint, or another finalization stage.
- The retained checkpoint reuses the owning run's worktree, branch, spec/base, completion attribution, committed/pushed draft-PR evidence, and completed stages. Pending operator changes are committed and pushed once under that retained attribution and refresh the existing draft evidence; no write agent runs.
- Resume then runs the ready gate, followed by mutation and runtime-smoke verification that the first red gate prevented, and flips the existing draft PR once only after all pass.
- A green resumed gate completes the same owning row. A red resumed gate returns that row to failed/resumable with `ready_gate_failed`, leaves the PR draft, and remains admissible for another gate-only resume.

## Work

- Record and resolve exhausted-red origin and same-run finalization lineage separately from durable status and composed operator error.
- Route only the eligible row through the retained finalization checkpoint; keep all other `ready_gate_failed` rows on their existing admission paths or refusals.
- Preserve the exhausted-red settlement and successful in-loop repair paths.
- Document gate-only recovery and its failure boundary.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner.test.ts` `caps ready gate repairs and settles as ready_gate_failed when exhausted` stays green and is extended as preservation coverage for the owning failed/resumable row, unchanged checked criteria, and absent ready flip; `v2/src/execution/write-loop.test.ts` `repairs a red ready gate through a write iteration` and `v2/src/execution/workflow-runner.test.ts` `routes a red ready gate through bounded repair before settlement` stay green.
- [ ] A new pre-fix-failing `v2/src/daemon/daemon-resume.test.ts` regression drives a real exhausted-red implement completion through the configured non-timeout repair cap, then asserts `run list` returns `status: "failed"`, `resumable: true`, and `error.reason: "ready_gate_failed"` / `error.nextAction: "resume"`; `run wait` returns `runStatus: "failed"` with the same resumability and error; and `jarvis run resume` accepts that same run without a write-agent invocation.
- [ ] That regression defines the retained finalization checkpoint: operator changes are finalized once with the original completion attribution, commit/push and existing-draft evidence are reused or refreshed without a duplicate PR, then the resumed ready gate, mutation verification, and runtime smoke run in order. A green gate completes the same row, makes list and wait non-resumable, and performs exactly one draft-to-ready flip.
- [ ] The same `daemon-resume` coverage makes the resumed gate red twice: each attempt returns the same row to `failed` / `ready_gate_failed` / resumable, dispatches no write agent, performs no ready flip, and admits the next resume.
- [ ] A pre-fix-failing eligibility matrix in `v2/src/daemon/daemon-resume.test.ts` admits only a failed row with same-run `loop_finished` exhausted-red terminal evidence and its retained checkpoint. It refuses timeout, blocked-repair, unsettled-repair, iteration-limit, unrelated-finalization, mismatched-lineage, and missing-checkpoint `ready_gate_failed` rows; `v2/src/daemon/run-operator-error.test.ts` keeps the composed `error.reason` / `error.nextAction` projection aligned without treating those response fields as durable-row fields.
- [ ] Inverting each added guard turns a named regression RED: exhausted-red origin and repair-count evidence (eligibility matrix), failed status and same-run lineage (eligibility matrix), retained checkpoint (missing-checkpoint case), no-agent dispatch (green and repeated-red lifecycle), repeated-red settlement (repeated-red lifecycle), and ready-flip suppression (red lifecycle).
- [ ] `v2/docs/operator-runbook.md` § Gate trust says repair-budget exhaustion remains `failed` / `ready_gate_failed` / resumable, that only the recorded exhausted-red lineage gets gate-only resume, and that a genuinely `completed` implement row still implies a green gate.
- [ ] `v2/docs/write-behavior.md` documents the exhausted-red origin evidence, retained finalization checkpoint, gate-only repeated resume, and green/red outcomes; `v2/docs/v1-behaviors.md` records the same operator-visible v2 semantics.

## Documentation updates

- `v2/docs/operator-runbook.md` — gate trust and eligible recovery.
- `v2/docs/write-behavior.md` — terminal evidence, checkpoint, and resumed tail.
- `v2/docs/v1-behaviors.md` — v2 operator-visible recovery semantics.
