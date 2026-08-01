Verifying the spec structure and key references against the repo before issuing the verdict.
# Verdict: required refinements

## Structural — spec is not runnable as drafted

The index routes only two subspecs (`00-daemon`, `01-cli`) while the tree-model work lives in `02` and `03`, which are unreachable from `index.md`. Seven of nine intent acceptance criteria have no routed subspec. This is a merge artifact, not intentional design.

**Required outcomes:**
- `index.md` must link every subspec that implements intent behavior, in dependency order.
- Remove the spurious `01-cli.md` stub (duplicate daemon tasks, empty decisions, redundant human-only AC). It violates same-seam serial guidance by parallel-touching `pipeline-observation.ts` with `00`.
- Renumber to a coherent three-subspec chain: daemon projection → join/display nodes → expansion/viewport.
- Repair all dead cross-references (prerequisite filenames, sibling links) so implement agents follow valid paths.
- Complete or delete truncated prose in `00` (dangling *"Stage `startedAt`/`endedAt` for"* clause).

**Rationale:** Index routing is the spec's execution contract. Orphaned subspecs and broken links strand implement runs regardless of subspec quality.

---

## Intent prerequisites — false gate

`intent.md` prerequisites claim `projectPipelineSnapshot` already exposes `createdAt` and terminal finish time. Committed `PipelineSnapshot` has only `pipelineId`, `name`, `state`, and `stages`. Those fields are `00`'s deliverable, not a pre-existing dependency.

**Required outcome:** Reword prerequisites to describe committed code today, or scope them to post-`00` state explicitly.

**Rationale:** Spec guidance treats prerequisites as validation gates. A false prerequisite either blocks drafting incorrectly or misleads implementers about baseline.

---

## Intent coverage — decisions without pins

Several intent decisions appear in subspec prose but lack acceptance criteria:

| Intent behavior | Gap |
|---|---|
| Pipeline `project` from first joined run | Decision in join subspec, no AC |
| Display node `kind` | Tasks name it; ACs say "depth tags" only |
| Pipeline/stage row-string helpers | Tasks present, no AC |
| Composed public API `(snapshots, runs, expansion, selection) → nodes` | Split across join + flatten with no integrated AC |
| Queued runs vs unattributed segment | Brief requires a Queue segment; join subspec puts all unmatched runs in `unattributed` with no queued exclusion |

**Required outcomes:**
- Add automated pinning ACs for pipeline `project` derivation and display-node `kind`.
- Add ACs for pipeline/stage row-string helpers if this slice ships them (fan-out AC partially covers branch cell only).
- Add a composed entrypoint AC in the flatten subspec stating that wrapping join output satisfies the intent's single-builder contract.
- Declare queue routing explicitly: either builder input excludes `status === "queued"` (queue is a sibling segment at integration) or document deferral with a test at monitor wiring. Leaving it undeclared risks queued rows in unattributed.

**Rationale:** Spec guidance requires every runtime-behavior change to name a failing-test AC. Intent ACs must be traceable to routed subspec ACs.

---

## Brief alignment — undocumented bridge decisions

**Unattributed retention:** Brief § Left pane says unattributed segments use viewport FIFO. Intent and join subspec keep `filterMonitorRunsForLiveWindow` for unattributed only. This is a defensible slice-2 bridge (pipeline-attributed runs escape the legacy window; unattributed keeps current filtering until monitor integration), but the spec never states it.

**Required outcome:** Add an explicit decision in the join subspec: slice 2 retains `filterMonitorRunsForLiveWindow` for unattributed; segment FIFO replaces it at monitor integration. Note that monitor wiring must stop applying the global pre-filter (`tui-entry.tsx`) once the tree builder owns unattributed filtering.

**Rationale:** Without the bridge note, implementers and reviewers read a brief contradiction and may "fix" behavior the intent deliberately defers.

---

## Daemon subspec (`00`) — tighten pins

The daemon subspec is sound in scope but needs refinement:

**Required outcomes:**
- Add `v2/docs/v1-behaviors.md` to documentation updates (wire-shape change to existing `pipeline_list` projection).
- Split the finish-derivation AC that bundles unrelated `branchKey` projection guards — finish tests should only mutate finish derivation.
- Pin terminal `finishedAtMs` null edge cases: terminals must always project a non-null finish time, or define and test an explicit fallback when publication and stage `endedAt` are absent.
- Drop the redundant human-only guard-inversion AC from `01-cli` (file deleted); keep automated pinning + checkpoint-comment ACs in `00` only. Remove duplicate `(Manual)` guard-inversion ACs from join/flatten subspecs where automated tests already cover the same guards.

**Rationale:** Spec guidance requires `v1-behaviors.md` on existing-functionality changes. Conflated ACs produce false RED signals. Human-only ACs should be reserved for genuinely unautomatable verification.

---

## Join subspec — field names and IDs

**Required outcomes:**
- Correct the run-side join key to match wire types: `run.workflow?.invocationId` (not `workflow.workflowInvocationId`). Stage side remains `workflowInvocationId`.
- Align stage node id format between intent and subspec (intent: concatenation; subspec: colon-delimited). Pick one canonical form and apply consistently.
- Add a one-line decision for duplicate `workflowInvocationId` across stages (e.g., first match wins, or unsupported).

**Rationale:** Wrong field names produce implement-time discovery failures. Id format drift between intent and subspec causes review churn.

---

## Flatten subspec — viewport semantics

**Required outcomes:**
- Pin what `maxVisibleRows` counts: visible flattened display nodes from join+flatten; collapsed descendants excluded; unattributed rows outside pipeline FIFO scope.
- Strengthen FIFO AC beyond singular drop: require iterative oldest-terminal-pipeline removal until within budget when overflow exceeds one pipeline's subtree.
- Add one AC combining collapse with overflow (e.g., collapsed pipeline subtree excluded from row count; multi-terminal drop under budget pressure).
- State that FIFO operates on flatten output only — snapshots are not pre-filtered before join.
- State that initial `expandedNodeIds` is caller-supplied; this module defines no default. State reveal-on-select precedence: effective expansion = `expandedNodeIds ∪ ancestors(selectedNodeId)`; selection forces ancestor visibility.

**Rationale:** Ambiguous row counting and singular-drop ACs allow implementations that pass tests but violate intent retention and collapse behavior.

---

## Subspec sizing — no split required

Join (fan-out, unattributed filter, row helpers) and flatten (collapse, reveal, ordering, FIFO) are correctly bundled as two subspecs. The coupling is inherent to a single flatten pass. Do not split further; close coverage gaps with ACs instead.

**Rationale:** Splitting would create artificial seams and duplicate fixtures without improving independent testability. The advocate's sizing assessment holds.

---

## Summary

The spec's architecture (daemon projection → pure join → pure flatten) matches intent. The daemon subspec is implementable. The tree-model subspecs are well-drafted but **orphaned, cross-wired wrong, and missing behavioral pins**. Refinement is primarily mechanical (index repair, renumber, delete stub, fix links) plus a bounded set of coverage and alignment fixes (queue routing, unattributed bridge, join field name, viewport counting, missing ACs, `v1-behaviors.md`, prerequisite correction). No architectural rethink is needed.