# Adjudicator verdict

Required refinements before the spec is implementation-ready:

## Subspec 00 (instrument and promote)

1. **Publication contract vs current docs** — State explicitly that today’s “empty critic verdict converges without landing” behavior (documented in `workflow-runner.md`) conflicts with the intent and is a plausible contributor for some failures. Documentation updates must treat `workflow-runner.md` as the primary fix; only touch `write-behavior.md` if a conflicting bullet remains after that edit.

2. **Two code paths, one promotion contract** — Require that intent stage promotion is satisfied whether publication runs through review-step landing, the completion tail, or both—not only shared trace logging. Acceptance or tasks must make clear that both seams honor the same promote → cleanup → commit behavior.

3. **`durableDir` / target resolution** — Require that promotion uses the configured durable output directory (e.g. landing `durableDir` / builder field), not a hard-coded `ready-intents/` literal that tests happen to use.

4. **Empty verdict + completion publication** — Decide and document that an approving empty verdict still runs the full git-enabled completion publication path (commit and, when enabled, push/PR), including how publication is attributed when the actuator did not run. The empty-verdict acceptance test must fail if only review landing runs and the tail is skipped.

5. **Tracing vs promotion** — One sentence in problem or decisions: structured `intent_finalization` traces remain required even when promotion fixes known gaps (e.g. empty-verdict), so production can still explain any remaining short-circuit.

6. **Tasks vs existing isolation test** — Tasks must distinguish the existing single-step review-landing test from the new full split → review → commit regressions so implementers cannot close 00 by extending only the isolated step.

7. **`v1-behaviors.md`** — Add a documentation-updates entry for 00 (or an explicit cross-reference that 01/02 own it) so spec guidance is not violated: publication contract changes belong in the parity catalog, not only in later slices.

8. **Trace field semantics** — Documentation for `intent_finalization` must explain operator-readable meaning of `phase`, `branch`, and `stopReason`, not only that the event exists.

## Subspec 01 (honest settlement)

9. **Review-step `boundary_committed` ordering** — Scope must include dishonest `done` emitted before landing/finalization finishes (production pattern: `boundary_committed` then failed or stranded stage). Tasks/acceptance must require honest settlement for that ordering, not only the completion committer stub case.

10. **Which attempt and which paths** — Clarify for intent publication split across review landing and completion tail: which run/attempt must not record `outcomeKind: "done"` / `runStatus: "completed"` when work is still uncommitted, and whether `completion_commit_failed` (or equivalent) must name stage paths, promoted paths, or both.

11. **Finalization vs `invocation_failure`** — Post–all-roles-`ok` failures must be classifiable when the fault is in the workflow tail after review returns complete, not only when failure is injected inside review finalization. Tasks or an acceptance criterion must block a review-only classifier fix that still mislabels tail failures.

12. **Stable `error.reason`** — Decide and document one operator-facing reason for post-invocation finalization failure with populated stage (extend `landing_failed` vs a dedicated reason), how it differs from `completion_commit_failed`, and that it pairs with `nextAction: "resume"` and `retryable: true` when promotion is pending—shared by 01 tests and 02 recovery.

13. **Split vs review row disagreement** — The “empty failed row vs log `loop_finished` complete” acceptance criterion must pin which durable run id is authoritative for `list`/`wait`, and what the operator row must show when logs disagree (non-empty reason, retryable, nextAction).

## Subspec 02 (recovery)

14. **Which run to resume** — Document which failed row the operator resumes (the id shown by `list`/`wait` after intent workflow redirection rules) and which row must carry the recovery `error.reason` and `nextAction: "resume"`.

15. **Resume reconstruction** — Acceptance must cover that `jarvis run resume` succeeds for populated-stage finalization failure without re-entering the write loop or re-invoking split/critic/actuator—either by extending the existing resume reconstruction pattern or a dedicated finalization-replay path. Inverting admission must still fail the workflow recovery test.

16. **Full publication replay** — Recovery acceptance must match the intent: not only file promotion and commit, but the same completion publication behavior as the happy path when git is enabled (push/PR hooks or equivalent assertions used elsewhere in workflow tests), or an explicit documented stub pattern that still proves the tail ran.

17. **`freshDispatch`** — An acceptance criterion must assert resume uses persisted snapshot replay, not `freshDispatch` review replay (aligned with existing landing-failed resume tests).

18. **Scope boundaries** — Out of scope: git-disabled / no-commit intent runs if recovery is git-enabled-only; finalization failures with populated stage only—not every `landing_failed` (e.g. validation errors with empty stage).

## Index / intent alignment

19. **No split of 01** — Keep three subspecs; widen 01 rather than splitting, provided tasks and acceptance explicitly cover boundary ordering, tail-vs-review settlement, and operator-row completeness as above.

20. **Intent documentation map** — Ensure the combined doc updates across subspecs still satisfy intent: `workflow-runner.md` (publication + settlement + recovery), `operator-runbook.md` § Recovery, `v1-behaviors.md` (00 may cross-ref but behavior changes must be cataloged before merge).

## Rationale (summary)

Production failures combine missing promotion (including empty-verdict tail skip), premature `done` boundaries, misclassified `invocation_failure`, empty operator rows, and resume refusal. The three-slice order is sound, but the draft under-specifies dual landing/tail seams, completion publication when the actuator is skipped, honest boundary timing on the review step, operator-visible run identity for settlement and recovery, and parity documentation in `v1-behaviors.md`. Without these refinements, implementers can pass isolated tests while leaving occurrence #8–class behavior and hand-recovery paths partially unfixed.