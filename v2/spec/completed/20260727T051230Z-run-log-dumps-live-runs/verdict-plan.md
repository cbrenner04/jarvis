## Verdict — refinement required

The single-subspec shape is correct for threading a snapshot/follow flag through daemon + CLI + TUI client. The following must be addressed before this spec is implementable.

### 1. Settlement termination for `--follow` is unowned (highest priority)
The spec asserts `--follow` "exits `0` when the run settles," but no such mechanism exists: the daemon's follow loop (`v2/src/persistence/log-stream.ts`) spins on `while (!signal?.aborted)` and never reads run status, and neither the CLI client nor the TUI tail client has settlement detection. The Decisions and task checklist only cover *skipping* the loop. Either:
- scope the mechanism — where run status is re-read, how the final-record/status-flip race is resolved, and what happens when a run settles between replay and subscribe — and split it into its own independently testable subspec (it is drivable at the daemon layer with a fake reader and a status flip, no CLI involved), with an index link and its own failing-test AC; **or**
- narrow the `--follow` AC to what the change actually delivers (stream closes when the daemon closes it or the client interrupts) and drop the settlement claim from Decisions and ACs.

Do not leave "exits when the run settles" as prose the implementer must invent.

### 2. Problem statement contradicts the code
`streamRunLogRecords` replays `logReader.tail(runId)` *before* entering the follow loop, and `v2/docs/write-behavior.md` documents that replay. So a live run with existing records should print them and then hang — not "print nothing." The spec must state the verified root cause of the observed silence (blocking loop vs. an independent flush/backpressure path). This matters concretely: if the silence has a buffering cause, snapshot mode still works but `--follow` ships with the operator's original symptom intact. One verified sentence in Problem, not a propagated claim.

### 3. Failing-test evidence must be anchored where the red actually appears
Two gaps:
- Pre-fix `run log` fails by *hanging*, not by asserting wrong output. The spec must say how the regression test produces a bounded red (e.g. a poll-interval override and/or a daemon-layer assertion), rather than a test that would hang the suite.
- The CLI test fake (`v2/src/testing/cli-test-helpers.ts`, `drainFrames ||= request.kind === "stream-open"`) may not reproduce a live follow at all, so AC #1's "fails against the pre-fix follow loop" may be unverifiable where it points. Either add a task item extending the helper, or re-anchor that AC's failure evidence to the daemon suite.

### 4. Daemon-layer coverage is missing
Every AC lands on `run.test.ts` / `tui-log-tail-client.test.ts`, while the change is in `parseTailStreamParams` and `streamRunLogRecords`. `v2/src/daemon/daemon-tail-stream.test.ts` has direct precedent for the payload edge cases the new field inherits (absent field, wrong type, string-JSON payload). Also, the existing `run.status !== "in-progress"` early return now composes with the new flag and is not covered by the guard-inversion AC. Add an AC naming that suite and covering both the field parse and the combined guard.

### 5. Drop the unverifiable preservation AC
"`runLogSubcommand` still awaits frames with no wall-clock deadline (unchanged; no timer is introduced)" is a negative existential with no anchor — nothing can turn it red, and it restates an existing Decision. Remove it from `## Acceptance criteria`, or replace it with a test that fails if a deadline were introduced.

### 6. CLI surface decisions are unstated
The `log` branch gates on `argv.length === 2` with the id at `argv[1]`. The spec must decide flag position (before/after the id, or both), what happens on unknown flags, and whether a `-f` alias exists (ruling it out explicitly is fine). `RUN_USAGE` needs `[--follow]`, with a matching task item and doc row — `write-behavior.md` documents command help.

### 7. Snapshot boundary needs a quiesced fixture
"Every record available at request time" has no crisp boundary if a writer is concurrently appending. The live-snapshot AC must specify a fixture with records pre-written and no racing writer, so the assertion is deterministic.

### 8. Doc updates must correct, not just append
- `v2/docs/write-behavior.md` currently documents replay-then-follow; the doc task must *correct* that description, not only add a modes row.
- The `operator-runbook.md` live-run gotcha bullet carries measured evidence (`run list` ~0.25s vs live `run log` >120s) that motivates the fix. Preserve the measurement; correct the claim rather than deleting the bullet wholesale.

### 9. Name the compatibility trade explicitly
Defaulting `follow` to `false` is the right call, but the Decisions rule out `true` without stating what `false` costs: a new CLI talking to an older daemon gets follow behavior regardless. One clause noting this is transient (per-digest keyed daemons, single operator, superseded daemons only own settling runs) makes the decision reviewable. No design change.

### Out of scope (note only)
Unknown run id → immediate exit `0` with no output is pre-existing behavior (`loadRun` miss → `onClose()`); this work merely unmasks it. A known-limitation line is sufficient; do not expand scope to fix it.