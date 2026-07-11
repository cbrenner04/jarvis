# Plan draft output contract and prerequisite blocker gate

Harden the `plan` write step's completion so a run publishes only when it produced a valid spec tree, and treat an agent-appended `## Blocker` as a terminal prerequisite failure.

## Verified prerequisites

- The `plan` preset builder (subspec 00) and the write step's run-time `intent.md` seeding (`intentSeed`) and completion publish (subspec 01) exist.
- `plan.prompt.draft` already instructs the agent to check `## Prerequisites` and append a `## Blocker` to `intent.md` on an unconfirmed prerequisite, writing no spec files. Source: `prompts/plan/draft.md`.
- Write loop maps a failing completion contract to a stop + `## Blocker` append keyed on `failedContractId`. Source: `v2/src/execution/write-loop.ts`, `v2/src/execution/write-loop.test.ts`.

## Decisions

- The write step's completion contract is made **injectable**: extend the write-step API (today the contract is a hardcoded `artifact.exists` check on `expectedArtifactPath`) so the `plan` preset supplies a plan-draft validator, and extend the contract-failure result to carry a **distinct failure reason** (e.g. `plan.draft.blocker` vs `plan.draft.shape`) rather than only the single contract id. Rule out reusing the hardcoded boolean `artifact.exists` — it cannot distinguish a blocker failure from a missing-index failure (AC-4). Sources: `v2/src/execution/write.ts` contract array, `v2/src/execution/write-loop.ts` `failedContractId` → `appendBlockerToSpec`.
- Draft output shape check ports v1's `countSubspecs` logic: `index.md` present and ≥1 file matching `/^\d{2}-.*\.md$/` in the spec dir; rule out the bare `index.md`-exists check from subspec 00 — an index with no subspecs is not a runnable tree. Source: `v1/src/modes/plan/draft.ts` `countSubspecs`.
- v1's `validateDraftOutput` returns `valid: true` for a genuine blocker and handles the non-zero exit in a **separate caller branch** (`run.ts` `plan: blocker` → `return 1`). This workflow instead maps a genuine blocker to a contract **failure** carrying the `plan.draft.blocker` reason, not a pass; rule out copying v1's `valid: true` blocker result — the v2 write step has no separate blocker branch and would publish a blocker-only tree. Source: `v1/src/modes/plan/draft.ts` blocker branch, `v1/src/modes/plan/run.ts` blocker exit.
- A genuine `## Blocker` is terminal: the workflow fails (non-zero) and opens no draft PR; rule out silent retry and rule out publishing a blocker-only tree — the operator must resolve the prerequisite.
- The blocker gate compares on-disk `intent.md` against the **known pre-run baseline** — the ready-intent content the preset seeded (subspec 00 threads it as `intentSeed`), captured as `intentBefore` before the agent runs (v2 has no such snapshot today; add it). A genuine blocker is exactly that baseline plus an appended `## Blocker` section, frontmatter immutable; rule out matching prose merely containing the word "blocker" — parity with v1 `isValidIntentModification` / `detectBlocker`.
- Contract precedence: blocker detection runs before the shape check, so a blocker run is reported with the `plan.draft.blocker` reason, not a "missing index.md" failure.

## Scope

- Extend the write-step API to accept an injected completion validator and to surface a distinct failure reason; supply the ported plan-draft validation (blocker detection + index/subspec shape) for the `plan` preset.
- Capture the seeded ready-intent as `intentBefore` before the agent runs and thread it into the validator for the blocker comparison.
- On a passing shape, allow the existing commit + draft-PR completion publish to proceed unchanged.
- On a failing shape or a genuine blocker, fail the workflow without publishing; report the blocker case with a reason distinct from missing-index.
- Do not add review, revision, or resume behavior; the workflow is draft-only.

## Acceptance criteria

- [ ] A run whose agent produces `index.md` plus ≥1 `NN-*.md` subspec passes the completion contract, commits, and opens a draft PR.
- [ ] A run producing `index.md` but zero `NN-*.md` subspecs fails the workflow (non-zero) and opens no draft PR.
- [ ] A run producing no `index.md` fails the workflow (non-zero) and opens no draft PR.
- [ ] A run where the agent appended an exact `## Blocker` section to the seeded `intent.md` and wrote no `index.md`/subspecs fails the workflow (non-zero), opens no draft PR, and carries a blocker failure reason distinct from the missing-index reason.
- [ ] The blocker comparison uses the preset-seeded ready-intent as the baseline; a modification to `intent.md` other than an appended `## Blocker` section (including frontmatter edits) is not treated as a blocker and fails the shape contract.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` with the injectable completion validator + distinct failure-reason channel, the plan draft completion contract (index + subspec shape), and the prerequisite blocker gate (blocker → workflow fails with distinct reason, no publish, compared against the seeded `intentBefore`).
- Update the `[v2 additive]` `plan` entry in `v2/docs/v1-behaviors.md` to record the ported draft-output contract and blocker gate, citing `v2/src/execution` and `v1/src/modes/plan/draft.ts` for parity.
