# 01 — Document the pre-ready fixer workflow

## Problem

The repo's current workflow docs describe `bun run ready` as the draft-to-ready gate but do not mention that it now runs `bun run check:fix` as its first step. Once subspec 00 lands, the documented operator workflow needs to match the updated `ready` sequence so reviewers understand why a readiness transition may rewrite files before the final verification pass.

## Decisions (locked)

- Keep documentation narrow and workflow-focused, but update every existing readiness description that would become inaccurate. `docs/workflows.md` and `docs/worktrees-and-commits.md` are the minimum required touch points.
- Describe the updated `bun run ready` sequence as `check:fix → install → typecheck → test → check`, then `gh pr ready` on success.
- Call out that `check:fix` is a mutating Biome pass across the worktree root and therefore may rewrite files right before the PR leaves draft.
- Explain the failure behavior at a high level: if any step in `ready` fails (including `check:fix`), the PR stays in draft and the branch can be corrected before retrying.
- Do not broaden the docs into claiming `check:fix` runs before ordinary patch-mode commits or during every agent iteration; it is specific to the `bun run ready` invocation at the draft-to-ready transition.

## Tasks

- [ ] Update `docs/workflows.md` anywhere the patch-mode or plan-mode readiness path is summarized so the diagrams/text mention the pre-ready `check:fix` step.
- [ ] Update `docs/worktrees-and-commits.md` in the draft PR lifecycle or readiness discussion so it explains that Jarvis may rewrite files with `bun run check:fix` immediately before running `bun run ready` and flipping the PR out of draft.
- [ ] Update any other existing readiness docs that currently describe automatic `gh pr ready` without the new pre-ready fixer step.
- [ ] Keep wording aligned with subspec 00's final behavior and avoid implying any broader pre-commit or per-iteration fixer automation.

## Acceptance criteria

- [x] `docs/workflows.md` describes `bun run ready` as running `check:fix → install → typecheck → test → check` followed by `gh pr ready`, not just the prior `install → typecheck → test → check` sequence.
- [x] `docs/worktrees-and-commits.md` states that the readiness transition may mutate files via `check:fix` (the first step of `bun run ready`) before the final checks run.
- [x] No existing readiness documentation still describes the draft-to-ready transition as beginning with `bun install` or omitting `check:fix` entirely.
- [x] The updated docs state that a failure in any `ready` step (including `check:fix`) leaves the PR in draft.
- [x] The updated docs do not claim that `check:fix` runs before ordinary patch-mode commits or during every iteration.

## Documentation updates

- [x] Update the minimum set of existing docs needed to keep all readiness descriptions accurate; avoid unrelated doc cleanup.

## Out of scope

- README restructuring or broader script catalog edits.
- Re-documenting the full `ready` script internals beyond the new pre-ready fixer step.
