# 00 Monitor revision-follow re-exec

A long-lived `jarvis tui` monitor keeps pre-handoff client code after daemon self-handoff and can render wrong status. The monitor compares its own loaded revision with the daemon `status` RPC's `loadedRevision` at connect (`v2/src/tui/tui-entry.tsx` already calls `client.status()` there) and on every refresh tick (new call added by this subspec), and re-execs onto current code on a stable mismatch.

## Decisions

- Monitor's own revision is captured once at monitor start with the resolver the daemon uses (`getCurrentHeadAsync` against the module dir), not re-read per refresh — re-reading HEAD tracks the checkout, not the loaded code.
- Each refresh tick adds a `client.status()` read alongside the existing `list()`/`pipeline_list()` calls, so the daemon revision is observed at connect and every tick, not only at connect.
- A failed status read (RPC error, malformed reply) resets the two-consecutive-read stability tracking to "no prior read" and never triggers a re-exec on that tick — rules out re-exec racing a daemon reconnect.
- "Stable" = the same non-`unknown` daemon `loadedRevision` observed on two consecutive successful status reads that also differs from the monitor's own revision; a single differing read never re-execs — rules out re-exec mid-handoff. Earliest possible re-exec is the first refresh tick after connect (connect's read is the first of the pair, the first tick's read is the second) — never at connect itself.
- `unknown` or absent (`undefined`) `loadedRevision` on either side never re-execs — rules out re-exec loops when git resolution fails or the daemon predates the field.
- Re-exec fires at most once per distinct stable daemon `loadedRevision` value: the child process is spawned with that revision recorded (env var), and a monitor process holding that marker never re-execs again for the same daemon revision even if the mismatch persists after re-exec (e.g. local checkout behind the daemon's) — rules out an unbounded re-exec loop when re-exec cannot itself fix the mismatch. A later, different daemon revision clears the marker's protection and can trigger one more re-exec.
- Non-empty command-editor dock buffer (`commandEditor()` grapheme buffer, focus `"command"`) or an in-flight command dispatch (`admissionPending`) defers re-exec; the decision re-evaluates each refresh and fires once both are clear — rules out discarding typed input or abandoning a pending approve/reject/steering RPC mid-flight.
- Decision is a pure exported predicate (monitor revision, previous and current daemon revision read outcome, dock-input emptiness, dispatch-pending flag, already-re-exec'd-for-revision marker); the re-exec action is an injected monitor dependency.
- Real re-exec dependency, in order: unmount Ink and restore the terminal, stop the refresh scheduler, close the daemon client/socket, then spawn `process.argv` with inherited stdio and the revision marker plus carried-over state (below) in env, and exit with the child's code. Re-exec nesting is bounded by the once-per-daemon-revision rule above; unbounded nesting across distinct revisions (one handoff, one re-exec) is an accepted cost.
- Selection/expansion state carries over across re-exec where cheap: `selectedNodeId` and `expandedPipelineNodeIds` are plain serializable state already on `TuiMonitorState`, passed to the child via env and restored as initial monitor state. Command-editor buffer contents are not carried over — re-exec is deferred while that buffer is non-empty, so it is always empty at re-exec time.
- No passive banner or stale-client hint — rules out indicator-instead-of-re-exec.
- `jarvis tui log` and one-shot CLI commands are out of scope.

## Acceptance criteria

- [x] A predicate test covers both directions: stable differing revision with empty dock input, no pending dispatch, and no matching re-exec marker → re-exec; matching revisions, `unknown`/absent on either side, a single unstable differing read, a failed read, non-empty dock input, pending dispatch, or a matching re-exec marker → no re-exec.
- [x] A predicate test proves a monitor already re-exec'd for daemon revision `R` does not re-exec again while the daemon still reports `R`, even though its own revision still differs; it re-execs once the daemon reports a different stable revision. This test fails without the once-per-revision guard.
- [x] A monitor test in `v2/src/tui/tui-entry.test.ts` drives refreshes through an injected/fake scheduler (never a real-timer wait), with an injected re-exec and a fake client whose `loadedRevision` differs from the monitor's revision, and proves re-exec is invoked without operator input; it fails against the pre-fix code.
- [x] A monitor test proves no re-exec while the dock input is non-empty or a command dispatch is in flight, and re-exec once both clear.
- [x] A monitor test proves matching revisions never invoke re-exec across multiple refreshes.
- [x] A monitor test proves a failed status read on a refresh tick resets stability tracking and does not re-exec on that tick or count toward the two-read requirement.
- [x] `v2/docs/tui.md` documents revision-follow re-exec (status read at connect and each tick, stability requirement, the once-per-daemon-revision guard, failed-read reset, defer while dock input is non-empty or a dispatch is pending, no passive banner) under `## Stable connection and reconnection`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/tui.md` — revision-follow re-exec behavior, under `## Stable connection and reconnection`.
