# Gate split-integrity on an actual split

## Problem

Plan self-review runs `validateSplitIntegrity` whenever the review verdict text
matches `/\bsplit\b/i` (`v1/src/modes/plan/review.ts:953`). A verdict mentioning
"split" only in passing triggers the check. When the actuator then makes a normal
(non-split) edit, no subspec files are removed or added, so
`validateSplitIntegrity` returns `"split verdict did not replace the original
subspec"` (`review.ts:294-296`) and the plan aborts `exit agent-error`. Observed
2026-07-11 on `workflow-loader-review-debate-steps`; regression from #1325.

## Decisions

- Gate on an actual split, detected structurally: a subspec file both removed and
  added between the pre-actuation snapshot and the post-actuation spec dir. Rules
  out gating on verdict text, the current false-positive source.
- No subspec removed **or** none added ⇒ no split performed ⇒ return `null` (not a
  failure). Either side empty means the actuator did not perform a split; a
  removed-without-added case is a distinct concern, deferred (intent out of scope).
- Export `validateSplitIntegrity` so the no-split and split-occurred paths are unit
  testable directly; the review runner otherwise offers no seam for this branch.

## Task checklist

- Drop the `/\bsplit\b/i.test(verdict)` gate at the `validateSplitIntegrity`
  call site; always call it and abort only on a non-null return.
- Change the no-split early return in `validateSplitIntegrity` from the error
  string to `null`.
- Keep scope preservation and index-link integrity enforcement unchanged for the
  split-occurred path.
- Export `validateSplitIntegrity` and add unit coverage.
- Update `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] A review verdict whose text matches `/\bsplit\b/i` but whose actuator
  removed and added no subspec files does not abort the plan (no
  `"split verdict did not replace the original subspec"` error).
- [x] When a subspec is both removed and added, a replacement missing from
  `index.md` still fails with the `split replacement is not linked from index.md`
  error.
- [x] When a subspec is both removed and added, a replacement that drops or
  duplicates an original task or acceptance outcome still fails with the
  `split did not preserve exactly once` error.
- [x] `bun run typecheck` passes and the plan-review surface tests stay green.

## Documentation updates

- `v2/docs/v1-behaviors.md` — correct the plan self-review split-integrity entry
  (line ~451) so it states the gate fires on an actual split (a subspec both
  removed and added), not on verdict text mentioning "split".
