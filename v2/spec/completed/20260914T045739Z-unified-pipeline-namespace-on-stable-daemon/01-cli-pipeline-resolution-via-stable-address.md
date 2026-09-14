# 01 — CLI pipeline listing and id resolution use the stable address only

## Problem

`pipeline list` and `resolvePipelineIdAcrossDaemons` discover keyed sockets and refuse `pipeline_id_set_incomplete` when any discovered socket is missing from the listing; a predecessor socket exiting mid-query breaks a prefix `pipeline list` just printed (2026-09-13 repro). Querying only the merged stable-address listing (00) and dropping the completeness check risks the opposite failure: a prefix could resolve to a local id while the true pipeline sits on an unreachable predecessor.

## Decisions

- CLI `pipeline list` and id/prefix resolution query only the stable address (depends on 00), not discovered generation sockets.
- Drop the per-socket completeness predicate. `pipeline_id_set_incomplete` now covers two cases: the stable-address listing itself is malformed or unavailable, or the listing came back `degraded` (00) and the argument is a prefix that didn't already resolve to an exact id present in it.
- A `degraded` listing blocks prefix resolution only. Exact-id resolution and plain `list` use the listing as returned either way — an exact id absent from a degraded listing still falls through to the caller's existing not-found handling, unchanged.
- Terminal-state refusal goes through `resolvePipelineDaemon` (owner resolution for command dispatch to the owning daemon), which still scans discovered sockets; that's out of scope here, covered by the run-routing prerequisite, not this subspec. The stable-only connect stub in this subspec's tests applies to `pipeline list` and `resolvePipelineIdAcrossDaemons` only, not to `resolvePipelineDaemon`.
- TUI pipeline listing (`tui-daemon-client.ts`) is unchanged; out of scope.
- A CLI built after this change talking to a stable daemon that predates 00 gets the old-shaped `pipeline_list` response (no `degraded` field, no predecessor merge); accepted gap until that daemon restarts onto the new build — no version-negotiation fallback.

## Acceptance criteria

- [x] A regression test in `v2/src/daemon/pipeline-daemon-resolution.test.ts` reproduces the 2026-09-13 shape: a stable-address listing includes a predecessor-held pipeline once, then a second stable-address query for the same prefix comes back `degraded` because the predecessor became unreachable; the second query refuses `pipeline_id_set_incomplete` rather than silently resolving the prefix to an unrelated local id. It fails against the pre-fix completeness predicate.
- [x] A test proves prefix resolution refuses `pipeline_id_set_incomplete` against a `degraded` stable-address listing even when a same-prefix local id exists, so a predecessor-only pipeline can't be shadowed by a wrong local match.
- [x] A test proves exact-id resolution and plain `list` succeed against a `degraded` stable-address listing.
- [x] Tests preserve exact-id, ambiguous-prefix, and unknown-id refusals from `resolvePipelineIdAcrossDaemons` with a connect stub that fails on any non-stable socket path; terminal-state refusal via `resolvePipelineDaemon` is unchanged and not covered by that stub.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — pipeline list/resolution boundary is the stable front door; a degraded listing refuses prefix resolution only.
- `v2/docs/v1-behaviors.md` — pipeline listing and prefix resolution are generation-transparent; degraded-listing prefix refusal.
- `v2/docs/daemon-host.md` — CLI no longer consults generation sockets for pipeline listing/resolution; terminal-state command dispatch still does.
