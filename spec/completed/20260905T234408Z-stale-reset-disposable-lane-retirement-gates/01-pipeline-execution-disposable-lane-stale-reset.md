# Pipeline execution disposable-lane stale-reset cross-link

## Problem

`v2/docs/pipeline-execution.md` documents shared stale-reset preflight on pipeline dispatch but does not yet name the disposable-lane gate sequence that [[pipeline-restart-discards-disposable-stage-state]] will call through `resetStaleWorkspace`.

## Decision ledger

- This subspec cross-links only; the full pipeline-restart operator contract stays in [[pipeline-restart-discards-disposable-stage-state]]; rules out duplicating restart disposal prose here.
- Name `ResetStaleWorkspaceOptions.disposableLane`, the path-scoped unlanded-commits refusal, runtime gate order, and which gates the marker bypasses; rules out implying standalone `run workflow` or bulk cleanup adopt disposable retirement by default.

## Task checklist

- In `v2/docs/pipeline-execution.md` § dispatch / stale-reset preflight, add a short cross-link to the shared `resetStaleWorkspace` gate sequence: live-held → open-PR (ready/multi) → claim → dirty inventory → `baseRef` block (path-scoped unlanded-commits refusal when no open PR; descendant and landed-criteria bypass when `disposableLane` is set by pipeline restart) → dirty refusal append → retirement; pointer to [[pipeline-restart-discards-disposable-stage-state]] for caller wiring, structural disposable validation, and operator semantics.

## Acceptance criteria

- [x] `v2/docs/pipeline-execution.md` cross-links the disposable-lane stale-reset gate sequence used by pipeline restart and defers the full operator contract to [[pipeline-restart-discards-disposable-stage-state]].

## Documentation updates

- `v2/docs/pipeline-execution.md` — disposable-lane stale-reset gate sequence cross-link for pipeline restart.
