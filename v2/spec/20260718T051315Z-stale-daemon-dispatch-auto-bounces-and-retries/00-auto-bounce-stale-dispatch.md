# Auto-bounce safe stale work dispatches

## Problem

The revision guard prevents stale code from accepting work, but every source merge now requires a manual daemon restart even when no iteration is live. Restart recovery already preserves resumable orphan rows.

## Decisions

- Auto-bounce CLI `run start`, `run resume`, and `run workflow` dispatches on their first revision mismatch, then re-run the revision guard and original mutating request exactly once; rules out refusal-by-default and recursive retries.
- Before stopping, fetch `list` from the stale daemon and refuse with every live run ID when any row has `isLive: true`; rules out using durable non-terminal status, which would block recoverable not-live orphans.
- Force the lifecycle stop only after the `isLive` gate passes; rules out the ordinary stop guard rejecting the same not-live non-terminal rows startup must reconcile.
- Expose startup recovery progress and `{ reconciled, resumed }` counts on daemon `status`; the bounce waits for recovery completion before reporting and retrying, which rules out log inference and a retry racing recovery admission.
- Count `resumed` only for successful automatic resume admissions; rules out counting unsupported or failed attempts as recovered.
- Emit loaded/current revisions, restart completion, both recovery counts, and retry intent on stderr; rules out an unauditable lifecycle mutation.
- Accept `--no-auto-bounce` on each affected CLI dispatch and restore the existing refuse-with-restart-guidance result; rules out machine-config expansion for a per-invocation safety choice.
- If listing, stopping, starting, reconnecting, or recovery readiness fails, return its actionable lifecycle/transport reason; if the post-restart guard still mismatches, return the mismatch without another bounce; rules out masking failure or looping.
- Keep TUI start/resume on the existing mismatch refusal because this slice's audit and opt-out contracts are CLI stderr/flags; rules out an invisible TUI restart without an operator-control surface.
- Leave health, status, list, log/tail, wait, pause, kill, and daemon lifecycle commands unchanged as non-triggering paths; rules out bouncing during observation, steering, or explicit lifecycle work.

## Work

- Return automatic recovery outcomes from the reconciled-run recovery path and publish pending/complete recovery counts through the daemon status wire contract.
- Add one shared CLI stale-dispatch wrapper that owns list safety, forced stop/start, reconnect, recovery readiness, one guard retry, stderr reporting, and lifecycle cleanup.
- Route fresh run starts, ordinary resumes, and all workflow-start presets through the wrapper; parse and strip `--no-auto-bounce` before their existing argument parsers.
- Cover safe bounce, live refusal, recovery counts, opt-out, restart/reconnect failures, persistent mismatch, and exempt paths.
- Align the durable daemon wire, CLI behavior, recovery runbook, and v1-parity catalog.

## Acceptance criteria

- [ ] Default CLI fresh-start, ordinary-resume, and workflow-start dispatches that first encounter a revision mismatch stop and start a daemon with no `isLive` rows, wait for startup recovery, pass a matching second guard, and send the original mutating request once.
- [ ] A mismatch with one or more `isLive` rows exits nonzero, names every live run ID, and does not stop, start, or dispatch; not-live non-terminal rows do not block the forced bounce.
- [ ] Successful bounce stderr names loaded/current revisions, confirms restart, reports distinct reconciled and successfully auto-resumed counts, and says the original dispatch is being retried.
- [ ] `--no-auto-bounce` on each affected CLI form sends no mutating request and returns the existing mismatch plus manual-restart guidance without listing or invoking daemon lifecycle operations.
- [ ] A list, stop, start, reconnect, or startup-recovery readiness failure exits nonzero with its underlying actionable reason; a second mismatch exits after that single retry attempt without another lifecycle cycle.
- [ ] `status` reports startup recovery as pending until admission attempts finish, then reports stable reconciled and successfully resumed counts; unsupported and failed admissions are not counted as resumed.
- [ ] `v2/src/cli.test.ts` adds start, resume, and workflow regression cases for safe bounce, live refusal, opt-out, failure, and one-retry behavior that fail against the pre-fix code; `v2/src/daemon/daemon-reconciliation.test.ts` adds recovery-status/count coverage that fails against the pre-fix code.
- [ ] `v2/src/tui/tui-daemon-client.test.ts` mismatch-refusal cases stay green (TUI behavior unchanged).
- [ ] Health, daemon status, list, log/tail, wait, pause, kill, and explicit daemon start/stop mismatch coverage stays green in `v2/src/cli.test.ts` and `v2/src/tui/tui-daemon-client.test.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/daemon-host.md` documents the startup-recovery fields and completion/count semantics on `status`.
- [ ] `v2/docs/write-behavior.md` documents default auto-bounce, the `isLive` gate, one retry, stderr output, `--no-auto-bounce`, failure behavior, exempt commands, and retained TUI refusal.
- [ ] `v2/docs/operator-runbook.md` replaces manual per-merge bounce guidance with automatic recovery, live-run refusal, audit output, and opt-out guidance.
- [ ] `v2/docs/v1-behaviors.md` replaces the v2-only refusal entry with the shipped CLI auto-bounce contract and retained TUI behavior.

## Documentation updates

- `v2/docs/daemon-host.md` — `status` startup-recovery wire contract and counts.
- `v2/docs/write-behavior.md` — dispatch, safety, retry, opt-out, output, failure, exemption, and TUI contracts.
- `v2/docs/operator-runbook.md` — normal automatic path and live-run/manual-control recovery.
- `v2/docs/v1-behaviors.md` — v2-only CLI auto-bounce and TUI refusal behavior.
