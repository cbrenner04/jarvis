---
name: superseded-daemon-releases-run-ownership
---

# A superseded daemon releases ownership of non-active runs to its successor

> **Absorbed by the daemon-identity chain (annotated 2026-09-12).** This seed is not separately scheduled: its fix falls out of [[daemon-identity-is-not-its-version]], specifically the `route-draining-runs-through-stable-daemon / route-draining-pipelines-through-stable-daemon` lane. It is retained rather than reaped because the chain's ready-intents do **not** carry the reproductions recorded below, and those are the evidence that the lane actually closed this shape. Reap it once that lane lands and the behaviour here is verified on `main` — not before.

## Problem

When the source digest rotates, the new daemon rebinds the socket but the old daemon stays alive holding `owner_identity` on its rows. The successor's `jarvis run kill --force` refuses `run_not_active` (`forceKillOwnerAdmits` sees the owner pid alive and not itself) and `pipeline resume` refuses `branch_not_resumable` (stage wedged `settlement_deferred` behind the paused run) — nothing can reach the old daemon to kill, resume, or hand off. Only exit: hand-SIGTERM the old daemon after its last live child finishes; while it still has a live agent child for a sibling lane there is no safe move at all. Evidence: #3464 (chess pipeline `c8901aa3`, run `98747dd7`, owner `40563`, four `daemon-entrypoint` processes holding the same socket path, 2026-09-04).

**Pipeline verbs have the same failure, and it is worse (2026-09-10).** An `awaiting-approval` pipeline whose owning daemon was superseded reports `ownerIdentity: null` and refuses **every** owner-routed verb with `pipeline_no_live_owner: … has no live owner; run jarvis daemon start, then retry` — including `resume` and `dismiss`, and including immediately after a successful `jarvis daemon start`. Starting a daemon cannot fix it, because the refusal is about the *recorded* owner, not about whether any daemon is live. A terminal/failed pipeline still routes (it falls back to the resolver's deterministic socket), so this strands live pipelines only. Evidence: pipeline `ed52b850` (fan-out at `approve-intent`, one failed plan lane) after merging a `shared/**` change rotated the digest; `280ad4c4`, `failed` at the same moment, resumed normally. The only way to re-drive the lane was to merge its intent PR and run the stage standalone. Any source merge while a pipeline sits at a gate does this, and merging stage PRs is how a pipeline lands its own work.

## Decisions

- A superseded daemon hands off or releases ownership of its non-active rows (paused, queued) so the successor's `kill --force` and `resume` admit them; rules out ownership pinned to a process that no longer serves the socket.
- Alternatively (or additionally), `forceKillOwnerAdmits` treats an owner whose recorded socket is no longer reachable as dead for non-active rows; rules out pid-aliveness alone deciding ownership — the socket is the service ([[terminal-state-honesty-invariant]], lifecycle surface).
- Active rows (a live agent child) are not force-transferred; rules out two daemons driving one invocation.
- Owner-routed **pipeline** verbs resolve a superseded owner the same way: a recorded owner that no longer serves its socket is not a live owner, and the verb routes to the daemon that does; rules out `pipeline_no_live_owner` on a machine with a healthy daemon, which no `daemon start` can clear.
- The runbook's superseded-daemon entry documents the recovery until the fix lands.

## Acceptance criteria

- [ ] A daemon test proves a successor daemon can force-kill and resume a paused run whose recorded owner is alive but no longer serves the socket; fails against the current `run_not_active` refusal.
- [ ] A test proves a run with a live agent invocation is not admitted for force-transfer.
- [ ] A test proves an `awaiting-approval` pipeline whose recorded owner is alive but no longer serves its socket admits `pipeline resume` and `pipeline dismiss` at the live daemon; fails against the current `pipeline_no_live_owner` refusal.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — ownership handoff on supersession.
- `v2/docs/operator-runbook.md` — replace the SIGTERM-by-hand recovery with the supported path.
