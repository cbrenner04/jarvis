---
name: pin-resume-next-action-contract
---

# Pin the `nextAction: "resume"` row-to-command contract

`run list` / `run wait` can advertise `nextAction: "resume"` for terminal
reasons that `run resume` still refuses. Pin the agreement generically so every
resume-advertised reason stays honored as new reasons are added.

## Decisions

- Every terminal reason that reports `nextAction: "resume"` must be accepted by `run resume`; rules out a `landing_failed`-only fix that lets the next reason drift the same way.
- Derive the guard's resume-advertised reason set from `composeRunOperatorError` (or one shared eligibility helper both list and resume use); rules out a hand-maintained duplicate table that drifts from row advertisements.
- Guard inverts: mutating the admission check to refuse a resume-advertised reason fails; rules out a table-only assertion with no enforcement hook.
- Rows reporting `nextAction: "stop"` or `"inspect_spec"` remain refused by `run resume`; rules out a guard so broad it makes every terminal row resumable.

## Acceptance criteria

- [ ] A guard covers every terminal reason that reports `nextAction: "resume"` (derived from `composeRunOperatorError` or the shared eligibility helper) and asserts `run resume` does not return `terminal_run`; inverting the guard fails.
- [ ] `daemon-resume.test.ts` flip/settlement refusal cases stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — row-to-command agreement for `nextAction`.
- Cross-link `v2/docs/v1-behaviors.md` resume baseline recorded by `resume-accepts-landing-failed`.

## Prerequisites

- A `failed` row with `error.reason: "landing_failed"`, `retryable: true`, and `nextAction: "resume"` is accepted by `jarvis run resume`.
