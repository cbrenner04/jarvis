---
name: resume-accepts-landing-failed
---

# Resume accepts a `landing_failed` row

A run settled `failed` / `landing_failed` reports `retryable: true` and
`nextAction: "resume"` on `run list`, but `jarvis run resume` refuses with
`terminal_run: Cannot resume a failed run`. The write step is committed; only
publication failed.

## Decisions

- Make `landing_failed` genuinely resumable via `run resume`; rules out demoting the row to `retryable: false`.
- Resume replays publication from the persisted write snapshot; rules out re-invoking the write-step agent.
- Extend shared daemon resume-eligibility to admit `landing_failed` failed rows; rules out a `run resume` one-off that leaves `list`/`wait` advertising unreachable remediation.

## Acceptance criteria

- [ ] A run settled `failed` / `landing_failed` with `retryable: true` and `nextAction: "resume"` is accepted by `jarvis run resume` and replays publication from its persisted write snapshot.
- [ ] A regression drives failing-then-succeeding publication end to end and asserts the resumed run lands its PR without re-running the write step; it fails against the current `terminal_run` refusal.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Publication / completion failures — `landing_failed` is resumable; drop any implication that abandon-and-re-run is the recovery.
- `v2/docs/v1-behaviors.md` — `landing_failed` failed rows are resumable via `run resume`.

## Prerequisites

- Merge-first sibling `pin-resume-next-action-contract` after this slice (same resume-eligibility seam; do not plan or run in parallel).
