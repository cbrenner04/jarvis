# Plan draft output shape contract

Make the `plan` write step's completion contract injectable and carry a distinct failure reason, then supply a draft-shape validator so a run publishes only when the agent produced a runnable spec tree (index + at least one subspec). The prerequisite blocker gate is subspec 03.

## Verified prerequisites

- The `plan` write step, its run-time `intent.md` seeding (`intentSeed`, subspec 01), and its completion publish (subspec 01) exist.
- The write step's completion contract today is a hardcoded `artifact.exists` check on `expectedArtifactPath`. Source: `v2/src/execution/write.ts` contract array.
- The write loop maps a failing completion contract to a stop keyed on `failedContractId`. Source: `v2/src/execution/write-loop.ts`.

## Decisions

- Make the write step's completion contract **injectable**: extend the write-step API so the `plan` preset supplies a validator, and extend the contract-failure result to carry a **distinct failure reason** (e.g. `plan.draft.shape`, with room for `plan.draft.blocker` in subspec 03) rather than only the single contract id; rule out reusing the hardcoded boolean `artifact.exists` — it cannot distinguish failure kinds. Sources: `v2/src/execution/write.ts`, `v2/src/execution/write-loop.ts` `failedContractId`.
- Draft output shape check ports v1's `countSubspecs` logic: `index.md` present and ≥1 file matching `/^\d{2}-.*\.md$/` in the spec dir; rule out the bare `index.md`-exists check from subspec 01 — an index with no subspecs is not a runnable tree. Source: `v1/src/modes/plan/draft.ts` `countSubspecs`.
- On a passing shape the existing commit + draft-PR completion publish proceeds unchanged; on a failing shape the workflow fails (non-zero) and opens no draft PR.
- Do not add blocker detection (subspec 03); the shape validator alone treats a blocker-only tree (no index) as a shape failure until subspec 03 distinguishes it.

## Scope

- Extend the write-step API to accept an injected completion validator and to surface a distinct failure reason.
- Supply the ported draft-shape validator (index + ≥1 `NN-*.md` subspec) for the `plan` preset.
- Leave the passing-shape commit + draft-PR publish unchanged.

## Acceptance criteria

- [x] A run whose agent produces `index.md` plus ≥1 `NN-*.md` subspec passes the completion contract, commits, and opens a draft PR.
- [x] A run producing `index.md` but zero `NN-*.md` subspecs fails the workflow (non-zero) and opens no draft PR.
- [x] A run producing no `index.md` fails the workflow (non-zero) and opens no draft PR.
- [x] The completion-contract failure result carries a distinct failure reason (`plan.draft.shape`) rather than only a contract id.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` with the injectable completion validator + distinct failure-reason channel and the plan draft shape contract (index + subspec shape).
- Update the `[v2 additive]` `plan` entry in `v2/docs/v1-behaviors.md` to record the ported draft-output shape contract, citing `v2/src/execution` and `v1/src/modes/plan/draft.ts`.
