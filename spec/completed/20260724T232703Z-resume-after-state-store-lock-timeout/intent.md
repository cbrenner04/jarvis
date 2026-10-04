---
name: resume-after-state-store-lock-timeout
---

# Resume after state-store lock timeout preserves a completed write step

## Problem

When a store write still throws `database is locked` (including after busy-timeout expiry under
contention), the run settles `run_execution_failed` with `harness_failure`, `retryable: false`, and
`nextAction: "stop"`. That discards a workflow that already committed its write-loop boundary —
same signature as the 2026-07-24 intent strandings.

## Decisions

- Operator error contract: dedicated `error.reason` (e.g. `state_store_lock_timeout`), `retryable: true`,
  `nextAction: "resume"` — same `run resume` admission as `surviving_mutation_failed`, not
  `role_timeout`'s `retry_later` workflow re-dispatch.
- Recovery is `jarvis run resume` on the failed row, continuing from the persisted write-step
  checkpoint without re-invoking the completed write step.
- A completed write-step boundary on disk must survive the failure row — rules out demoting
  `resumable` or rolling back the completion commit.
- Out of scope: eliminating lock errors entirely; WAL + busy timeout ships in
  `state-store-wal-concurrent-writes`.

## Acceptance criteria

- [ ] A test contends the store past its busy timeout after a committed write-loop boundary and
      asserts the run settles with a retryable operator error and a resume path, not
      `harness_failure` / `nextAction: "stop"`; it fails against the pre-fix code.
- [ ] The same test asserts the completion boundary and git commit from the finished write step
      remain intact after the failure settles.
- [ ] `jarvis run resume` accepts the failed row and continues without re-running the completed
      write step; it fails against the pre-fix code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — contended-store lock-timeout row: reason, retryability, `nextAction`.
- `v2/docs/operator-runbook.md` — recovery when a run fails on store lock after a completed write
  step.
- `v2/docs/v1-behaviors.md` — operator failure semantics for store lock timeout after write commit.

## Sibling order

Same `StateStore` / runbook seam — plan and run serially after each predecessor merges to `main`:
(1) `state-store-wal-concurrent-writes`, (2) `state-store-wal-sidecar-copy-and-remove`, (3) this
intent. No parallel plan fan-out on one base.

## Prerequisites

- `state-store-wal-concurrent-writes` merged — non-zero `busy_timeout` so tests can drive lock
  timeout past a committed write-loop boundary.
