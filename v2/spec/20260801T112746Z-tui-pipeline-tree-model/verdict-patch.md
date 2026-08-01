Reviewing the implementation against the completed spec and weighing which findings still require action.
Checking reveal-on-select behavior and whether the subspec AC for sibling stages is adequately covered.
# Verdict

Implementation matches the landed three-subspec contract. Daemon projection, join, flatten, ordering, FIFO, and documentation satisfy the checked acceptance criteria. No behavioral code changes are required for merge.

Three coverage gaps remain against explicit spec contract. Address these before closing the patch.

---

## Required outcomes

1. **Pin within-pipeline duplicate `workflowInvocationId` first-wins (subspec 01).**  
   The decision requires that when two stages in one snapshot share a `workflowInvocationId`, only the first in `stages` order receives the matching run. `claimInvocationId` implements this, but no test exercises it. A pinning test must assert one run nests under the first stage only and the second stage’s `runs` stay empty; inverting the claim guard must turn the test RED.

2. **Pin sibling-stage collapse on reveal-on-select (subspec 02).**  
   The reveal AC names “sibling pipelines/**stages** collapsed.” The existing test covers sibling pipelines only. Add a fixture with two stages under one pipeline, select a run in the first stage, and assert the sibling stage row remains visible while its runs are omitted from flatten output. Inverting stage-run expansion without stage-id membership in effective expansion must turn the test RED.

3. **Align mutation checkpoint comments with guarded symbols (subspec 01).**  
   The width-reservation checkpoint references `formatPipelineTreeCell`; the guarded code is `joinPipelineTreeCells` / `formatTreeCell`. Checkpoint comments must name the actual mutation target so guard-inversion runs remain trustworthy.

---

## Rationale

Items 1–2 are explicit runtime decisions or AC wording without failing pins — regressions would pass CI silently. Item 3 is a spec-mandated checkpoint hygiene issue, not a behavior change.

---

## Not required (upheld defenses)

- Terminal ordering/FIFO via `finishedAtMs !== null` — consistent with subspec 00’s null/non-terminal invariant and daemon `derivePipelineFinishedAtMs`.
- Max stage `endedAt` without status filter, including skipped rows — subspec 00 decision; tests pin the landed rule.
- Publication-failure finish from last stage `endedAt` — subspec 00 names only `terminalPublicationSucceededAt` plus stage `endedAt` fallback.
- Active-only viewport overflow returning unbounded rows — subspec 02 forbids dropping actives, not fitting them; integration concern.
- Cross-pipeline duplicate invocation, row-helper `selectedRunId` API, `intent.md` checkbox drift, global `tui-entry.tsx` pre-filter — integration or process follow-ups outside this slice’s ACs.
- Composed-entrypoint coverage beyond the existing happy-path `buildMonitorPipelineTree` test — AC satisfied; deeper paths exercise the same join+flatten functions.