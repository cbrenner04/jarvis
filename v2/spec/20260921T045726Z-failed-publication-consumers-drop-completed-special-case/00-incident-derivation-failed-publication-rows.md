# Incident derivation keys on failed publication rows

`operator-incidents.ts` `commitFailureDetail` reads `terminalFailureDetail` from any row whose cause is `completion_commit_failed`, regardless of status. After migration `032` only a `failed` row legitimately carries that cause.

## Decisions

- `commitFailureDetail` requires `run.status === "failed"` — rules out fixture-only changes that leave the status-blind production read in place.
- Workflow incidents keep keying their transition on the durable settled marker; publication detail is read from a `failed` row — rules out restoring #3907's row-status scan.
- Scope is `completion_commit_failed` and `ready_flip_failed`; `ready_flip_failed` carries no path-bearing detail, so it emits `terminal:failed` without `detail` — rules out inventing detail for it.

## Tasks

- [ ] Gate `commitFailureDetail` in `v2/src/daemon/operator-incidents.ts` on a `failed` row.
- [ ] Update `v2/src/daemon/operator-incidents.test.ts` publication-failure fixtures to settle `failed` and prove the marker emits `terminal:failed` with commit-failure detail.
- [ ] Add a `ready_flip_failed` fixture beside the `completion_commit_failed` one.

## Acceptance criteria

- [ ] `operator-incidents.test.ts` proves a failed `completion_commit_failed` row plus a failed settled marker emits `cause: "failed"`, `transition: "terminal:failed:<settledAt>"`, and retained commit-failure detail without a completed-row fixture.
- [ ] `operator-incidents.test.ts` proves a failed `ready_flip_failed` row plus a failed settled marker emits `cause: "failed"` and `transition: "terminal:failed:<settledAt>"` with no `detail`.
- [ ] `operator-incidents.test.ts` proves a `completed` row carrying a stale `completion_commit_failed` cause and failure message supplies no commit-failure `detail`; fails against the pre-fix `commitFailureDetail`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — reconcile the incident-derivation entries with the failed-row invariant; remove completed-with-failure-cause compatibility wording.
