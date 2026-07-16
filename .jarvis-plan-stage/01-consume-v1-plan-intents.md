# Consume v1 Plan Intents

## Scope

Apply the same success boundary to every ready-intent read by v1 plan promotion, including no-commit publication.

## Decisions

- Reuse the promotion input boundary from intent mode, not a plan-only deleter; rules out divergent path safety and batch handling.
- Put committed deletion in `plan: draft` after validated output exists; rules out a separate cleanup commit.
- Delete no-commit inputs only after the complete spec tree lands successfully; rules out the current archive-time delay and early deletion on draft/review failure.
- Preserve external-spec archival cleanup as an idempotent fallback; rules out widening this change into cleanup redesign.

## Work

- Replace the single ready-intent deletion path with collection-based safe consumption.
- Consume external ready-intents at successful no-commit plan completion without changing failure preservation.
- Align `v1/docs/spec-guidance.md`, `v1/docs/plan-mode.md`, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] Successful v1 plan promotion consumes every ready-intent read after its byte-identical `intent.md` and complete spec tree are durable, in committed and no-commit modes.
- [ ] Committed deletion lands in `plan: draft`; failed publication leaves the source queue intact and retryable.
- [ ] No-commit draft, review, validation, or filesystem failure leaves every ready-intent intact.
- [ ] Missing, external, or symlink-escaped mapped targets remain undeleted.
- [ ] `v1/test/plan-delete-ready-intent-command.test.ts` adds pre-fix-failing no-commit success/failure coverage; `v1/test/plan-delete-ready-intent.test.ts` retains committed path-safety and all-recorded-input coverage.
- [ ] `v1/docs/spec-guidance.md`, `v1/docs/plan-mode.md`, and `v2/docs/v1-behaviors.md` document ready-intents as open work and the shipped success boundary.
- [ ] Existing external-spec cleanup behavior remains covered and unchanged.
