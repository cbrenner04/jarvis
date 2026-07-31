# Markdown-only fence through completed-run recovery

Completed-run retry and `jarvis run resume` must not commit markdown-only violations that the live
repair loop already rejected.

## Prerequisites

- Subspec `00` persists markdown output roots at first repair freeze alongside
  `ReadyGateRepairFenceProvenance`.

## Decisions

- Completed-run retry and resume reconstruct and reuse the persisted markdown-only layer from frozen
  provenance — they do not re-derive roots from the dirty worktree.
- Missing or invalid markdown-only provenance on a markdown-only run fails closed as
  `completion_commit_failed` — rules out bypass when provenance is absent.

## Work

- Re-enforce the markdown-only fence on completed-run retry and `jarvis run resume` before generic
  completion commit or publish.
- Add focused regressions for each entry point and document recovery semantics.

## Acceptance criteria

- [x] Focused `write-loop.test.ts` completed-run recovery coverage proves process restart followed by
      completed-run retry cannot commit or publish a rejected non-markdown path on a markdown-only run,
      retaining persisted markdown roots and offending-path evidence; fails against recovery that
      omits or bypasses the markdown-only layer.
- [x] A separate `jarvis run resume` regression proves resume cannot commit or publish that same
      rejected path after restart on a markdown-only run; fails against recovery that recomputes or
      omits persisted markdown-only provenance.
- [x] Recovery regression tests fail when the persisted markdown-only validation is inverted or
      bypassed.
- [x] `v2/docs/write-behavior.md` documents markdown-only provenance persistence, fail-closed
      reconstruction, and the completed-run retry/resume boundary.

## Documentation updates

- `v2/docs/write-behavior.md` — durable markdown-only repair-fence recovery.
