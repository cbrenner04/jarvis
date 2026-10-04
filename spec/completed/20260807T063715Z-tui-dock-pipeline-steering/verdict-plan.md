Grounding the verdict in the codebase and existing spec patterns before issuing refinements.
## Verdict: required refinements

### 1. Restructure subspecs to match real seams and dependency order

The `00-daemon` / `01-cli` split mislabels the work (no daemon handlers or `jarvis pipeline` CLI are edited), duplicates the full Work list in both files, inverts dependencies (parser removal must land before dispatch can pass), and leaves documentation split across subspecs while the runbook AC sits only in `01-cli`. Reorganize the index into independently testable slices aligned with the actual surfaces (`tui-command-parser`, `tui-daemon-client`, `tui-entry` dispatch/eligibility, docs) or collapse to one commit-sized subspec. Every original task and acceptance outcome must appear exactly once across replacements, with disjoint Work per slice and serial order that unblocks each slice (parser/catalog before dispatch). Rationale: spec guidance requires atomic subspecs at module boundaries; the current layout will strand or duplicate implement runs.

### 2. Define pipeline → daemon-client routing as an operator-visible contract

The decision to use the "owning daemon client discovered on refresh" is not implementable as written: production has `runOwners` but no `pipelineOwners`, and `mergePipelineSnapshots` concatenates without owner tracking. The spec must state how `pipelineId` resolves to the client that issued the snapshot (build owner map on refresh, duplicate-`pipelineId` preference, and behavior when a retained row has no live owner). Rationale: without this, eligible mutations may RPC the wrong socket or fail silently; intent requires real steering, not aspirational routing.

### 3. Name pipeline RPC client methods explicitly

`TuiDaemonClient` already exposes `resume(runId)` for run-level RPC. Add a decision that pipeline mutations use distinct method names aligned with wire RPCs (`pipelineApprove`, `pipelineReject`, `pipelineResume` or equivalent), and rule out overloading `resume`. Rationale: prevents implementer ambiguity and accidental run-level dispatch.

### 4. Align intent success-feedback wording with the settled contract

Intent says admitted "decision id"; the subspec correctly follows `start` and surfaces `pipelineId` on success. Update intent (or elevate the subspec decision as authoritative) so success feedback is `pipelineId`, not a composite decision string. Rationale: removes intent/spec drift that would confuse implementers and runbook authors.

### 5. Pin async mutation semantics inherited from `start`

"Mirroring `start` settlement semantics" is insufficient without testable pins. Add acceptance criteria (with named `tui-entry.test.tsx` tests that fail pre-fix) for: daemon refusal on approve/reject/resume (verbatim `lastCommandResult`, buffer/focus retained); `shouldApplyCommandSettlement` stale suppression on async completion; and shared `admissionPending` blocking a second submit while a mutation is in flight. Rationale: spec guidance requires failing-test ACs for new runtime behavior and mutation coverage for guards; `start` already pins these patterns and pipeline steering must not regress them implicitly.

### 6. Make selection-resolution rules explicit for resume (and approve/reject)

Feedback codes bound much of the matrix but resume eligibility is underspecified: state that `resume` requires a **pipeline** row selection with no ancestor walk-up; stage or run selections yield `not_pipeline` or `run_leaf`. Approve/reject on a pipeline parent row (not an awaiting stage) yields `not_awaiting_stage`. Rationale: matches the zero-argument, selection-resolved model used by `expand`/`collapse` and prevents implementer invention of walk-up behavior.

### 7. Standalone ineligible-matrix acceptance criteria

Happy-path ACs bundle "ineligible selection reports named feedback and issues no RPC" as a clause, while mutation checkpoints reference separate ineligible test titles not listed as their own ACs. Add explicit ACs naming each ineligible test (or one AC enumerating all named tests), including reject's symmetric guard. Rationale: spec guidance prefers explicit pins per guard; bundled clauses are easy to tick without full matrix coverage.

### 8. Add reject mutation checkpoint

Mutation checkpoints cover approve and resume only; approve and reject share eligibility guards. Add a reject ineligible mutation checkpoint (or document a shared guard with both pin titles linked to one directive). Rationale: spec guidance requires mutation coverage per modified guard.

### 9. Parser migration AC for positional arguments

`01-cli` rules out positional CLI mirroring but does not pin the migration from today's `approve foo` → `recognized_unavailable` behavior. Add an AC that `approve foo` (and symmetric reject/resume forms) parse as `unexpected_arguments`, with parser and entry tests updated accordingly. Rationale: prevents silent regression of the existing parametrized unavailable/parse-failure surface.

### 10. Consolidate documentation ownership and operator semantics

Assign all documentation updates to one subspec. The runbook must document: live verb eligibility and outcomes for approve/reject/resume; relationship of `stale_non_targetable` to retained rows without a live owner; that `resume` on awaiting-approval pipelines is eligible at the dock but may be refused by the daemon (pointing operators to approve/reject); and the Shift+Enter correction (doc-only, per overhaul brief). `v2/docs/v1-behaviors.md` parity entry stays in scope. Rationale: intent requires operator-visible semantics; split/empty doc sections and missing awaiting-resume guidance create review and runbook drift.

### 11. Distribute intent acceptance criteria across the final subspec layout

Intent AC #4 (parser no longer `recognized_unavailable` + runbook live verbs) appears only in `01-cli`; dispatch ACs appear only in `00-daemon`. After restructuring, every intent acceptance outcome must map to exactly one subspec AC with no gaps or duplicates. Rationale: index-routed runs tick per subspec; orphaned intent criteria will not complete the spec.

---

**Disposition:** The behavioral center (selection-gated pipeline steering, fake-client tests, `start`-like feedback, named ineligible codes) is sound. Merge is blocked on structural subspec repair, the missing pipeline-owner routing contract, and the async/refusal/ineligible test pins needed to make "mirror `start`" enforceable rather than implied.