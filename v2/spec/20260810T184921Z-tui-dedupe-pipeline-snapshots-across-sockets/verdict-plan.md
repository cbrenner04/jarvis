## Verdict — refinement required

The spec's core direction (dedupe by `pipelineId` inside `mergePipelineSnapshots`, scope confined to that function) is sound and stays one commit-sized subspec. No split. Seven refinements are required before it ships.

### 1. Collision rule must prefer the live/freshest observation, not the most terminal one

The stated rule — finished (`finishedAtMs !== null`) beats unfinished — is unsafe against how the TUI accumulates snapshots. `pipelineSnapshotsBySocketPath` is spread forward every refresh tick (`v2/src/tui/tui-entry.tsx:623-624`), entries are retained on observation failure by design (`:652-654`), and nothing ever deletes a key — a socket that disappears keeps its last-good snapshot in state for the rest of the session. In the exact two-daemon drain window this spec targets, the draining daemon's final observation of a pipeline is the terminal one, so "finished wins" elects the dead daemon and can freeze a still-running pipeline as `succeeded` indefinitely. That is a worse defect than the duplicate rows being fixed.

The spec must resolve this explicitly, either by preferring the observation from a currently-connected/live socket (with `finishedAtMs`/`endedAt` as tiebreaks) or by evicting snapshot keys for sockets no longer in the connection set — and must pin the chosen behavior with an acceptance criterion covering the stale-socket case (dead socket carries terminal, live socket carries running). The cited precedent `mergeRunLists` (`v2/src/daemon/merge-run-lists.ts:15`) prefers `row.isLive && !existing.isLive` — freshest owner, not most terminal. Decisions currently invoke that precedent for keying but silently diverge from it for preference; whichever way this lands, Decisions must name the liveness alternative and say why it was taken or ruled out.

### 2. Two downstream per-id dedups already exist and must be reconciled, not left dangling

`pipelineObservationBuckets` (`v2/src/tui/tui-monitor-lines.ts:276-291`) already collapses to one bucket per `pipelineId` with precedence `awaitingGate > running > failed > done`. `canonicalPipelineSnapshots` (`v2/src/tui/tui-attention-rows.ts:61-73`) already does first-snapshot-per-id wins, carrying a doc comment that describes precisely the rule being replaced. The spec's "downstream consumes the deduped list unchanged" leaves a dead precedence branch and a lying comment over a no-op loop.

The spec must:
- Declare which rule is canonical when the merge-level winner and the dock's `awaitingGate > running > failed > done` precedence disagree, and reconcile the two — dock counts are operator-visible behavior, so this is a decision, not cleanup.
- Cover removing or correcting the now-redundant `canonicalPipelineSnapshots` dedup and its stale comment as an explicit task.
- Account for the `@mutate` directive currently anchored on the `candidateOutranksCurrent` precedence branch (`v2/src/tui/tui-monitor-lines.test.ts:2022`): if that branch becomes unreachable, its checkpoint goes hollow and blocks completion. The spec must say what happens to it.

### 3. Named the existing multi-socket tests it will change

Two pre-existing tests encode the current concatenate-then-resolve behavior and will not survive: the four-socket colliding-id dock-count test (`{running:1, awaitingGate:1, failed:1, done:1}`, `tui-monitor-lines.test.ts:2021`) and the contradictory-snapshot test (`succeeded/finishedAtMs:20` on `/a` vs `running/null` on `/b`, asserting `running: 2` plus a literal dock line, `:2215`). AC 5 as written ("merge behavior unchanged for one socket") is true but points at the wrong tests. The spec must name these two by title and state the new expected values, or state that they are deliberately retired and why — plus add a dock-count AC under the reconciled rule from item 2.

### 4. Keystone directive must be writable

`@mutate` is single-line text replacement; "revert the return to sorted-socket-path concatenation" is a multi-line revert of a `Map` rewrite and cannot be authored as one directive against the implementation shape the spec implies. The spec must constrain the implementation enough that a single-line anchor expressing baseline (undeduped) semantics exists, and phrase the keystone against that anchor.

### 5. Split the collision AC and fix its fixtures

The current AC 4 asks one test to kill both first-encounter-wins and last-wins. Those need opposite fixtures: refuting first-wins requires the winner at the *later* sorted socket path; refuting last-wins requires it at the *earlier* one. Write these as two criteria (or one test with both arrangements, each named), with the socket-path arrangement stated explicitly rather than left as "swap socket order."

### 6. Pin node-id uniqueness at the depth where the bug bit

The trapped `j`/`k` came from stage and branch node ids (`${pipelineId}:${stageId}:${branchKey}`, `tui-monitor-pipeline-tree.ts:104`), not just pipeline rows. AC 2's fixture must be pinned with the pipeline **expanded** so stage/branch ids are exercised, not left at the aggregate level. Also cover the empty/undefined snapshot map (cheap, and the function's early return is load-bearing). A single socket serving one id twice is not a real case — skip it.

### 7. Documentation

`v2/docs/v1-behaviors.md:595` documents this exact surface ("TUI multi-daemon aggregation … Each run ID dedupes to the daemon reporting `isLive`"). This spec changes existing functionality on that surface, so per repo convention the v1-behaviors entry must be updated alongside the operator-runbook line — add it to Documentation updates and the task checklist.

### Accepted as scoped

Owner/display skew from `buildPipelineOwners` (`tui-entry.tsx:341-353`, first-wins in sorted socket order, independent of which snapshot renders) predates this change and both daemons sit over the same run store. One "unchanged, out of scope" line in Decisions is sufficient; no design change owed.

State in Decisions that the collision rule is a total order, so the fold is order-independent for three or more colliding snapshots — a sentence, not an extra AC. Clarify the two-finished case (different `finishedAtMs`) in the same clause.