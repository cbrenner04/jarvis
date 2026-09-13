# Direct-predecessor ownership directory

## Problem

Drain observation today only tracks a predecessor's live run IDs (`unionLiveRunIds`), uniformly across the real handoff predecessor and any legacy digest-keyed peers, and carries no full row data. Establishing an authoritative owner route needs a projection that returns full rows, sourced only from the direct predecessor.

## Behavior

The daemon's private endpoint answers an owner-local list projection scoped to its own `activeRuns`/store, with no limits, dismissal, or retention applied — every row it currently holds live. A run ownership directory polls only `predecessorSocketPath` (never `enumerateOtherDaemonSockets` legacy peers) against this projection and keeps a run's row only while that poll reports it live.

## Decisions

- Populate the directory only from the explicit handoff predecessor (`predecessorSocketPath`); legacy digest-keyed peers keep their existing `supersede` admission cutoff and their existing advisory `unionLiveRunIds` liveness union unchanged, and are never added to this directory; rules out folding `enumerateOtherDaemonSockets` peers into ownership the way `buildDrainObservers` currently folds them into one observed-socket list.
- The owner-local private projection applies no limits, dismissal, or terminal retention; it returns every row the owning process currently considers live; rules out a truncated or filtered snapshot the directory would treat as complete.
- Clear a run's directory entry on any failure of that poll — an RPC error or a probe reading `absent`/`stale` — rather than retaining the last snapshot; rules out serving a stale owner row (or a stale `isLive: true`) once the owner has stopped confirming it. This is stricter than the existing advisory `unionLiveRunIds` mechanism, which is unaffected and keeps its current retain-on-transient-failure behavior.
- Reuse the existing drain observer's poll cadence (`pollIntervalMs`, default `500`) for directory polling; no new interval configuration.

## Tasks

- Add an owner-local `list` projection variant with no limits/dismissal/retention, served on the private endpoint.
- Add a run ownership directory that polls only `predecessorSocketPath` against that projection and exposes cached owner rows keyed by run id, clearing an entry on any poll failure.

## Acceptance criteria

- [ ] `daemon-drain-observer.test.ts` proves the ownership directory holds a run's row only while the predecessor's poll reports it live, and clears that entry immediately on a poll RPC failure or on `absent`/`stale` liveness, with no retained stale snapshot; it fails against the pre-fix advisory `unionLiveRunIds`, which carries no row data and retains on transient RPC failure.
- [ ] `daemon-private-endpoint-bind.test.ts` proves only `predecessorSocketPath` feeds the ownership directory and enumerated legacy peers never do, even though legacy peers remain wired into `observePredecessorDrain`/`supersede` unchanged; it fails against a naive implementation that sources ownership from the same combined socket list `buildDrainObservers` produces today.
- [ ] A test proves the owner-local private projection returns every currently-live row with no limit/dismissal/retention applied, independent of the public `list` handler's selection rules.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — define the owner-local private projection and the direct-predecessor-only ownership directory, and that legacy peers are excluded from it.
