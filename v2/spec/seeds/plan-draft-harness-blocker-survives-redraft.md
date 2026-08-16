---
name: plan-draft-harness-blocker-survives-redraft
---

# Harness-appended plan-draft blocker survives into the next attempt and re-fails a passing redraft

## Problem

When staged plan-draft normalization rejects a tree (e.g. `has a multi-surface ## Decisions bullet`), the write loop appends `## Blocker\n\nArtifact contract check failed: <reason>` to staged `<stage>/intent.md` (`v2/src/execution/write-loop.ts`, `appendBlockerToSpec` via the `artifact.exists` branch of `blockerPath`). Nothing removes it. On the next attempt the agent redrafts the subspecs — the new tree passes `normalizePlanDraftSpecDir` — but the `plan.draft.blocker` contract (`v2/src/execution/write.ts`, `hasGenuineBlocker(intentSeed, intentAfter)`) sees seed + harness blocker, treats it as an agent-authored blocker, and fails the run again with `plan.draft.blocker`. Observed 2026-08-16 on `plan/v2-init-command`: attempt 1 (`47665078`) tripped the splitter on a `CLI … daemon` Decisions bullet; attempt 2 (`6dc75d35`) produced three single-surface subspecs that pass the normalizer, yet the run failed on the stale blocker. The operator saw a blocker naming a subspec file that no longer existed and could not tell what was still wrong.

## Decisions

- Blockers the harness authors on staged `intent.md` are advisory to the *next* attempt's prompt, not evidence of a genuine blocker: strip any `## Blocker` section whose body starts with `Artifact contract check failed:` from staged `intent.md` before the plan-draft step prompts, so `plan.draft.blocker` only fires on agent-authored text. Rules out teaching `hasGenuineBlocker` to skip by prefix (it is a shared parser used by non-plan steps) and rules out leaving the stale text in place.
- The prior harness reason still reaches the agent: surface it in the redraft prompt (existing normalizer-message plumbing) rather than via the file.
- A genuine agent-authored `## Blocker` on staged `intent.md` still fails the run unchanged.

## Acceptance criteria

- [ ] A staged `intent.md` carrying only a harness `Artifact contract check failed:` blocker from a prior attempt does not fail `plan.draft.blocker` on the next attempt when the redrafted tree passes normalization; pinned by a test that fails against the current pass-through.
- [ ] After that attempt the staged `intent.md` no longer contains the harness blocker.
- [ ] A staged `intent.md` with an agent-authored `## Blocker` still settles `plan.draft.blocker`, pinned by an existing or new test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — in the draft output shape contract paragraph, note that harness-appended blockers on staged `intent.md` are cleared before the next plan-draft attempt and never count as genuine blockers.
- `v2/docs/v1-behaviors.md` — amend the plan-draft normalizer rejection diagnostics entry accordingly.
