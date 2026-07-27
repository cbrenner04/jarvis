## Verdict — changes required

Five upheld findings. Three are blocking correctness/gate failures; two are cheap consistency fixes.

### 1. `--follow` must terminate on settlement even when no further record is appended (blocking)

`FileLogStream.follow` yields only on new appends — an empty poll tick yields nothing. The status re-read in `streamRunLogRecords` sits inside the `for await` body, so it only runs after a record arrives. Any run that goes terminal without appending another record leaves the follower blocked forever. This is not hypothetical: the kill handler (`v2/src/daemon/daemon.ts`, `commitGuardedKill`) flips the run terminal and appends no record, so `run log <id> --follow` on a killed run hangs — exactly the symptom this spec exists to remove.

Required outcome: the run-status re-read happens on a time basis independent of record arrival (spec 01's Decisions say "on each `follow()` poll tick … including empty ticks"), so the stream closes within a bounded interval of settlement regardless of whether further records are written. Spec 01 also fixes `follow()` itself as unchanged; both Decisions must end up jointly satisfied, or the subspec text corrected to the mechanism actually shipped. Add a test that fails against the current shape: run flips terminal, no subsequent append, call still returns.

### 2. Records written at or after termination must be drained, not dropped (blocking)

Two drop paths exist today:
- Between the replay read and the post-replay status re-read: on terminal, the code returns without re-reading the log.
- Inside the loop: `onData(record)` → terminal → `return` abandons the remainder of the pending batch and any later appends.

The second is the normal case, not a rare race. `v2/src/execution/workflow-runner.ts:2512` commits `runStatus: "completed"` *before* appending `loop_finished` (2519) and the completion-publication trace. A follower that observes terminal on the preceding record returns before those records exist, so `--follow` systematically loses the terminal record operators most need.

Required outcome: on observing a terminal status, everything persisted for that run beyond the last delivered seq is emitted before the stream closes — including records appended after the status flip. Spec 01 promises this ("no record written before termination is dropped") and `daemon-host.md` documents it; the code must make both true. Cover it with a test that appends `loop_finished`-style records after the status flip and asserts delivery.

### 3. The test that pins the drop must become a drain test

`follow closes without an extra record when the run is already terminal by the first re-read` asserts the follow reader is never consulted. It satisfies the AC's letter while locking in the behavior finding #2 forbids. Rewrite it so a record appended after replay but before/at the terminal re-read is asserted *delivered*, then the stream closes.

### 4. `bunx biome format v2/src` is red (blocking the ready gate)

Three files fail formatting (`daemon-tail-stream.test.ts`, `tui-log-tail-client.test.ts`, `run.test.ts`). Must be clean.

### 5. CLI default must match spec 00's Decision and doc/test text

Spec 00 states `run log <id>` "sends no follow flag"; the implementation sends `follow: false` while the AC test is named `run log sends no follow flag by default`. Make the wire behavior and the spec/test language agree — omitting the field when not following is the reading that also keeps the compatibility clause in Decisions literally true.

### 6. Doc precision

- `v2/docs/v1-behaviors.md` claims `--follow` matches "the old default behavior." It does not: `--follow` now exits on settlement, and `paused`/`queued` runs (deliberately outside `isTerminalRunStatus`) keep tailing. Correct the clause.
- `v2/docs/daemon-host.md`'s follow-completion paragraph must describe the mechanism as actually implemented after #1/#2 — including the drain guarantee and the tick basis for the status re-read.
- Add the known-limitation line the plan verdict asked for: an unknown run id exits `0` with no output (pre-existing; unmasked, not caused, by this change).

### Not required

Lenient `follow: "true"` → `false` coercion matches sibling `afterSeq` handling and is explicitly enumerated in spec 00's AC — leave it. The `readAllRecords` torn-line skip is pre-existing and unchanged. Continuing to tail a `paused` run is the correct reading of spec 01.