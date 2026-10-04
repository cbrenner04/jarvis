# Resume admission stamps the admitting daemon as owner

Daemon `resume` re-enters runs through `setRunStatus(…, "in-progress")` paths, leaving `owner_identity` at the dispatching generation; a later successor reconciles the resumed run as a dead-owner orphan (run `64b09d5d`, `killed`/`daemon_restart`). `StateStore.admitRunForResume` already stamps the current identity and refuses a live different owner; only some `workflow-runner-resume.ts` tails call it.

## Decisions

- Admit once in the daemon `resume` handler (`v2/src/daemon/daemon-run-lifecycle-handlers.ts`) via `admitRunForResume` before spawning, for every accepted resume shape — not per-executor call sites.
- Tails already calling `admitRunForResumeOrThrow` stay; a repeat admission by the same identity applies idempotently.
- Refusal (`owner_alive` / `claim_lost`) returns an RPC error carrying the existing refusal reason before any spawn or status write — never a silent local takeover.
- Automatic restart recovery gets the stamp by routing through that same `resume` handler; its failure-path `admitRunForResume` stays.
- Reconciliation (`beginRunReconciliation`) is unchanged; correctness comes from recording the right owner.

## Acceptance criteria

- [x] A daemon test drives dispatch on generation A, handoff to B with the run paused, `run resume` on B, then handoff to C, and asserts C leaves the run live and owned by B (no `run_reconciled`); it fails against the pre-fix code.
- [x] A daemon test asserts automatic restart recovery leaves the resumed row's `owner_identity` equal to the recovering daemon's identity; it fails against the pre-fix code.
- [x] A daemon test asserts `resume` is refused with the claim refusal reason when a different live daemon owns the row, with `owner_identity` and status unchanged and no run spawned.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — § Daemon retirement on supersession and the `resume` RPC row: resume/recovery re-stamp ownership; a live different owner refuses.
- `v2/docs/operator-runbook.md` — remove any gotcha about resumed runs reconciled as orphans after handoff.
- `v2/docs/v1-behaviors.md` — update only if it catalogs run ownership.
