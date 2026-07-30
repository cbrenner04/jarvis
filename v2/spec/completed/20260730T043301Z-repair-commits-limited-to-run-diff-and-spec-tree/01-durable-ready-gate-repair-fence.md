# Preserve the fence through completed-run recovery

A rejected repair must remain rejected after the process exits or a completed run is retried.

## Decisions

- Persist the frozen allowset with the completed run before repair completion can fail, together
  with durable rejection provenance: the normalized offending path and failure outcome.
- Completed-run retry and `jarvis run resume` reconstruct and reuse that original allowset; they do
  not derive a new allowset from the dirty worktree.
- Before generic completion can stage or publish recovery changes, enforce the persisted fence. A
  missing or invalid persisted fence fails closed as `completion_commit_failed`.

## Work

- Carry frozen-fence and rejection evidence through completed-run persistence and restart-safe
  reconstruction.
- Fence completed-run retry and resume before their generic completion commit or publish path.
- Add focused regressions for each entry point and document recovery semantics.

## Acceptance criteria

- [x] Focused `v2/src/execution/write-loop.test.ts` and completed-run recovery coverage prove a
      process restart followed by completed-run retry cannot commit or publish the rejected dirty
      path, retaining the original frozen allowset and offending-path evidence.
- [x] A separate `jarvis run resume` regression proves resume cannot commit or publish that same
      rejected path after restart; it fails against a recovery path that recomputes or omits the
      persisted fence.
- [x] Recovery regression tests fail when the persisted-fence validation is inverted or bypassed.
- [x] `v2/docs/write-behavior.md` documents durable fence provenance, fail-closed reconstruction,
      and the completed-run retry/resume boundary.

## Documentation updates

- `v2/docs/write-behavior.md` — durable ready-gate repair-fence recovery.
