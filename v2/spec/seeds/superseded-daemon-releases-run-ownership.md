---
name: superseded-daemon-releases-run-ownership
---

# A superseded daemon releases ownership of non-active runs to its successor

## Problem

When the source digest rotates, the new daemon rebinds the socket but the old daemon stays alive holding `owner_identity` on its rows. The successor's `jarvis run kill --force` refuses `run_not_active` (`forceKillOwnerAdmits` sees the owner pid alive and not itself) and `pipeline resume` refuses `branch_not_resumable` (stage wedged `settlement_deferred` behind the paused run) — nothing can reach the old daemon to kill, resume, or hand off. Only exit: hand-SIGTERM the old daemon after its last live child finishes; while it still has a live agent child for a sibling lane there is no safe move at all. Evidence: #3464 (chess pipeline `c8901aa3`, run `98747dd7`, owner `40563`, four `daemon-entrypoint` processes holding the same socket path, 2026-09-04).

## Decisions

- A superseded daemon hands off or releases ownership of its non-active rows (paused, queued) so the successor's `kill --force` and `resume` admit them; rules out ownership pinned to a process that no longer serves the socket.
- Alternatively (or additionally), `forceKillOwnerAdmits` treats an owner whose recorded socket is no longer reachable as dead for non-active rows; rules out pid-aliveness alone deciding ownership — the socket is the service ([[terminal-state-honesty-invariant]], lifecycle surface).
- Active rows (a live agent child) are not force-transferred; rules out two daemons driving one invocation.
- The runbook's superseded-daemon entry documents the recovery until the fix lands.

## Acceptance criteria

- [ ] A daemon test proves a successor daemon can force-kill and resume a paused run whose recorded owner is alive but no longer serves the socket; fails against the current `run_not_active` refusal.
- [ ] A test proves a run with a live agent invocation is not admitted for force-transfer.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — ownership handoff on supersession.
- `v2/docs/operator-runbook.md` — replace the SIGTERM-by-hand recovery with the supported path.
