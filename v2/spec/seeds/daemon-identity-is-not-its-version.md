---
name: daemon-identity-is-not-its-version
---

# The daemon's address should not change when its code does

## Problem

The daemon is keyed by a digest of the jarvis source tree, so its socket path changes every time the source changes. Rebuilding must not leave stale code serving — that requirement is real. But the mechanism makes the daemon's *address* a function of its *version*, and every operator-facing surface then has to know about versions.

The operator cost is not one bug. It is a standing tax the whole surface pays:

- `jarvis daemon status` probes the current digest and prints `stopped` while a healthy daemon serves every run on the machine. The runbook has to say "this reads exactly like the daemon died and my runs are orphaned, and it is not."
- A live run on a superseded same-key daemon renders `not-live`. `run resume` refuses `terminal_run`, `run kill --force` refuses `run_not_active`, and re-dispatch refuses naming a worktree lock. Every refusal is correct and the combination is indistinguishable from the deadlock shape whose recorded recovery is `kill -9` — on a daemon shared by every registered project.
- Pipeline id prefix resolution fails closed, because the invoking digest's socket is counted as an unanswered listing when it does not exist. `pipeline list` prints a prefix that every verb then rejects ([[prefix-resolution-refuses-on-an-absent-invoking-socket]]).
- `cleanup --abandon` reports `no daemon is listening` immediately after a source merge, on a healthy machine.
- Merging while lanes are live is a hazard the runbook must warn against, so merges have to be batched for moments when nothing is running — which is the opposite of what a queue-driven harness wants.
- A concurrent operator session on an unrelated project loses its daemon when *this* repo merges, because one binary serves every registered project (#3595).
- Keyed `.sock`/`.pid`/`.log` triplets accumulate and need their own cleanup slice and their own liveness classification.

Five open seeds exist for pieces of this ([[supersede-reaches-a-socketless-resident-daemon]], [[superseded-daemon-releases-run-ownership]], [[run-list-cannot-reach-superseded-daemon-runs]], [[init-check-probes-legacy-unkeyed-daemon-paths]], [[cleanup-never-reaps-socketless-daemon-pid-and-log-pairs]]), plus issues #3595 and #3464, plus 21 references across the operator runbook. Each has been treated as its own defect. They are one defect: callers must locate a daemon by version, and a caller never knows which version owns what it is asking about.

Nothing an operator does should require knowing the daemon's build. Rotation is an implementation detail of upgrading, and it has become the operator's problem.

## Decisions

- **One stable address.** Callers connect to a single well-known socket path and never compute, discover, or merge across digests. Version selection happens behind that address.
- **Upgrade is a handoff, not an address change.** When the source changes, the incoming daemon takes over the stable address and the outgoing one drains: it finishes the runs it owns, admits nothing new, and exits. The stable address serves the new daemon for new work throughout.
- **A draining daemon's runs stay reachable through the stable address.** `run list`, `run log`, `run wait`, `run kill`, and every pipeline verb must reach a run owned by a draining daemon without the caller knowing one exists. This is the property that retires the `not-live`-but-working shape, and it is the hard part — it likely needs the stable-address holder to route by run ownership rather than answer only for itself.
- Rules out keeping per-digest sockets and teaching each caller to merge across them: that is the current design, and the merging is exactly what fails closed or misreports at every call site.
- Deferred: whether the outgoing daemon keeps a private socket for the incoming one to route to, or whether ownership transfers with the live run state. Pin at the first implementing subspec; the operator contract above is what must hold either way.

## Acceptance criteria

- [ ] A test proves `daemon status` reports `running` when a daemon is serving and the current source differs from the one it loaded; it fails against the current digest-scoped probe.
- [ ] A test proves a run owned by a draining (superseded) daemon renders `live` in `run list` and is reachable by `run log`, `run wait`, and `run kill` through the stable address; it fails against the current per-key reachability.
- [ ] A test proves a pipeline id prefix resolves after a source change with no socket for the new source's own key; it fails against the current completeness predicate.
- [ ] A test proves a source change does not disrupt a second registered project's in-flight run (#3595's shape).
- [ ] A test proves an incoming daemon admits new work at the stable address while an outgoing daemon still drives its own runs, and that the outgoing daemon exits once they settle.
- [ ] A test proves no `jarvis` command computes or enumerates a source digest to locate a daemon — a structural guard over the CLI and command layers, so the coupling cannot grow back.
- [ ] `v2/docs/daemon-host.md` documents the stable address, the drain handoff, and ownership routing.
- [ ] `v2/docs/operator-runbook.md` — delete the digest-rotation, superseded-daemon, and "do not merge while lanes are live" guidance this retires, and say plainly that upgrades need no operator awareness.
- [ ] `v2/docs/v1-behaviors.md` records the replaced socket-addressing behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — stable address, drain handoff, ownership routing.
- `v2/docs/operator-runbook.md` — retire the rotation guidance wholesale.
- `v2/docs/v1-behaviors.md` — the replaced addressing behavior.
