# Plan prerequisite blocker gate

Treat an agent-appended `## Blocker` on the seeded `intent.md` as a terminal prerequisite failure with a failure reason distinct from a shape failure, using the injectable completion contract from subspec 02.

## Verified prerequisites

- The `plan` write step seeds `intent.md` from `intentSeed` before the agent runs (subspec 01).
- The completion contract is injectable and carries a distinct failure reason; the draft-shape validator (`plan.draft.shape`) exists (subspec 02).
- `plan.prompt.draft` already instructs the agent to check `## Prerequisites` and append a `## Blocker` to `intent.md` on an unconfirmed prerequisite, writing no spec files. Source: `prompts/plan/draft.md`.

## Decisions

- Capture the seeded ready-intent as `intentBefore` before the agent runs (the preset threads it as `intentSeed`, subspec 01); v2 has no such snapshot today — add it. A genuine blocker is exactly that baseline plus an appended `## Blocker` section, frontmatter immutable; rule out matching prose merely containing the word "blocker" — parity with v1 `isValidIntentModification` / `detectBlocker`. Source: `v1/src/modes/plan/draft.ts`.
- Map a genuine blocker to a contract **failure** carrying the `plan.draft.blocker` reason, not a pass; rule out copying v1's `validateDraftOutput` `valid: true` blocker result — the v2 write step has no separate blocker branch and would publish a blocker-only tree. Source: `v1/src/modes/plan/draft.ts` blocker branch, `v1/src/modes/plan/run.ts` blocker exit.
- A genuine `## Blocker` is terminal: the workflow fails (non-zero) and opens no draft PR; rule out silent retry and rule out publishing a blocker-only tree.
- Contract precedence: blocker detection runs before the shape check, so a blocker run is reported with the `plan.draft.blocker` reason, not a "missing index.md" (`plan.draft.shape`) failure.

## Scope

- Capture `intentBefore` before the agent runs and thread it into the completion validator.
- Add blocker detection (baseline + appended `## Blocker`, frontmatter immutable) to the plan completion validator, mapped to a `plan.draft.blocker` failure reason.
- Order blocker detection before the shape check.
- Do not add review, revision, or resume behavior; the workflow is draft-only.

## Acceptance criteria

- [ ] A run where the agent appended an exact `## Blocker` section to the seeded `intent.md` and wrote no `index.md`/subspecs fails the workflow (non-zero), opens no draft PR, and carries the `plan.draft.blocker` failure reason distinct from `plan.draft.shape`.
- [ ] The blocker comparison uses the preset-seeded ready-intent as the baseline; a modification to `intent.md` other than an appended `## Blocker` section (including frontmatter edits) is not treated as a blocker and falls through to the shape contract.
- [ ] Blocker detection runs before the shape check: a blocker run reports `plan.draft.blocker`, not the missing-index shape reason.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` with the prerequisite blocker gate (blocker → workflow fails with `plan.draft.blocker`, no publish, compared against the seeded `intentBefore`, ordered before the shape check).
- Update the `[v2 additive]` `plan` entry in `v2/docs/v1-behaviors.md` to record the blocker gate, citing `v1/src/modes/plan/draft.ts` for parity.
