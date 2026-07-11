# Plan draft output contract and prerequisite blocker gate

Harden the `plan` write step's completion so a run publishes only when it produced a valid spec tree, and treat an agent-appended `## Blocker` as a terminal prerequisite failure.

## Verified prerequisites

- The `plan` write step and its completion publish exist (subspec 00).
- `plan.prompt.draft` already instructs the agent to check `## Prerequisites` and append a `## Blocker` to `intent.md` on an unconfirmed prerequisite, writing no spec files. Source: `prompts/plan/draft.md`.
- Write loop already appends a blocker and stops on a failing completion contract. Source: `v2/src/execution/write-loop.ts`, `v2/src/execution/write-loop.test.ts`.

## Decisions

- Draft output contract ports v1's shape check: `index.md` present and ≥1 file matching `/^\d{2}-.*\.md$/` in the spec dir; rule out the bare `index.md`-exists check from subspec 00 — an index with no subspecs is not a runnable tree. Source: `v1/src/modes/plan/draft.ts` `validateDraftOutput` / `countSubspecs`.
- A genuine `## Blocker` in `intent.md` is a terminal outcome: the workflow fails (non-zero) and does not open a draft PR; rule out silent retry and rule out publishing a blocker-only tree — the operator must resolve the prerequisite. Source: `v1/src/modes/plan/draft.ts` blocker branch.
- The blocker gate accepts only the exact `## Blocker` heading and requires `intent.md` otherwise unchanged except for that appended section (frontmatter immutable); rule out matching prose containing the word "blocker" — parity with v1 `isValidIntentModification` / `detectBlocker`.
- Contract precedence: blocker detection runs before the shape check, so a blocker run is reported as a prerequisite failure, not a "missing index.md" failure.

## Scope

- Replace the `plan` write step's completion contract with the ported plan-draft validation (blocker detection + index/subspec shape).
- On a passing shape, allow the existing commit + draft-PR completion publish to proceed unchanged.
- On a failing shape or a genuine blocker, fail the workflow without publishing.
- Do not add review, revision, or resume behavior; the workflow is draft-only.

## Acceptance criteria

- [ ] A run whose agent produces `index.md` plus ≥1 `NN-*.md` subspec passes the completion contract, commits, and opens a draft PR.
- [ ] A run producing `index.md` but zero `NN-*.md` subspecs fails the workflow (non-zero) and opens no draft PR.
- [ ] A run producing no `index.md` fails the workflow (non-zero) and opens no draft PR.
- [ ] A run where the agent appended an exact `## Blocker` section to `intent.md` and wrote no `index.md`/subspecs fails the workflow (non-zero), opens no draft PR, and is reported as a prerequisite/blocker failure rather than a missing-index failure.
- [ ] A modification to `intent.md` other than an appended `## Blocker` section (including frontmatter edits) is not treated as a blocker and fails the shape contract.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` with the plan draft completion contract (index + subspec shape) and the prerequisite blocker gate (blocker → workflow fails, no publish).
- Update the `[v2 additive]` `plan` entry in `v2/docs/v1-behaviors.md` to record the ported draft-output contract and blocker gate, citing `v2/src/execution` and `v1/src/modes/plan/draft.ts` for parity.
