---
name: resume-stopped-write-run-from-snapshot
---

# Resume stopped workflow write runs from their snapshot

Killed workflow write runs and retryable completion failures are advertised as resumable, but the daemon respawns them with empty rules, artifact path, and bindings. The RPC reports success before the run fails `no_binding` without invoking an agent.

Reconstruct the stopped step's complete write-loop input from its persisted workflow snapshot before admitting resume. A valid resume must invoke the configured binding with the persisted step contract. An unreconstructible run must be rejected at admission and must not be offered as resumable by `list`, `wait`, or the CLI.

## Decisions

- Use one snapshot-to-write-input reconstruction path for paused and other resumable write runs; rules out divergent resume inputs.
- Require a matching executable snapshot step with rules, artifact path, agents, and model config for write-run resume eligibility; rules out status-only eligibility.
- Reject missing or unresolvable resume context with a named RPC error before spawning; rules out `{ ok: true }` followed by `no_binding`.
- Derive `list`, `wait`, and CLI resume guidance from the same eligibility check as RPC admission; rules out advertising a recovery the daemon rejects.
- Report snapshot reconstruction defects as unsupported resume context, not `no_binding` / `fix_config`; rules out blaming live config for missing persisted context.

## Out of scope

- `awaiting-human` and `revising` resume behavior.
- Daemon-restart run termination policy.

## Prerequisites

## Documentation updates

- `v2/docs/daemon-host.md` — snapshot-backed resume admission, eligible statuses, and error contract.
- `v2/docs/operator-runbook.md` — truthful daemon-restart and completion-publication recovery.
- `v2/docs/v1-behaviors.md` — record the corrected v2 resume behavior.
