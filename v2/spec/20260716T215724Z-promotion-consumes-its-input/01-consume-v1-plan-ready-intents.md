# 01 - Consume v1 plan ready-intents

V1 plan already stages safe ready-intent deletion into Git-backed draft output,
but no-commit success retains the ready-intent until later archival. The open-work
queue must reflect promotion immediately without changing archival cleanup.

## Decisions

- Reuse the safe publication-input deletion contract introduced by v1 intent; rules out a second path-containment policy for ready-intents.
- Preserve Git-backed deletion in the `plan: draft` commit after the write boundary passes; rules out a later standalone cleanup commit or direct checkout mutation.
- Consume a no-commit ready-intent only after draft, configured review, and durable spec writes all succeed; rules out deleting input on a failed or blocked plan.
- Leave external-spec archival pruning unchanged as an idempotent fallback; rules out widening promotion work into cleanup behavior.

## Acceptance criteria

- [ ] `v1/test/plan-delete-ready-intent-command.test.ts` keeps proving that a Git-backed plan commit contains the byte-identical `intent.md` copy and safe source deletion, while missing, external, and symlink-escaped targets remain untouched.
- [ ] `v1/test/plan-command.test.ts` adds a regression that fails against the baseline and proves a successful no-commit plan consumes its ready-intent after the complete spec output lands.
- [ ] `v1/test/plan-command.test.ts` proves draft, review, blocker, validation, and filesystem-publication failures retain the ready-intent for a safe retry.
- [ ] `v1/test/cleanup-command.sandbox-unrunnable.test.ts` external-spec cleanup tests stay green and continue to permit best-effort pruning when an old ready-intent remains.

## Documentation updates

- `v1/docs/plan-mode.md` — document successful promotion consumption for Git and no-commit output, plus failure retention and unchanged archival fallback.
- `v2/docs/v1-behaviors.md` — replace the no-commit retention statement with the new v1 plan boundary and retain the cleanup distinction.
