# 01 — Document the pre-ready fixer workflow

## Problem

The repo's current workflow docs describe `bun run ready` as the draft-to-ready gate, but they do not explain that Jarvis should first run `bun run check:fix` immediately before that gate. Once subspec 00 lands, the documented operator workflow needs to match the new harness behavior so reviewers understand why a readiness transition may rewrite files before the final verification pass.

## Decisions (locked)

- Keep documentation narrow and workflow-focused. The most relevant docs are `docs/workflows.md` and `docs/worktrees-and-commits.md`.
- Describe the readiness transition as a two-step local gate: first `bun run check:fix`, then `bun run ready`, then `gh pr ready` if both succeed.
- Call out that `check:fix` is a mutating Biome pass across the worktree root and therefore may rewrite files right before the PR leaves draft.
- Explain the failure behavior at a high level: a fixer or ready failure leaves the PR in draft so the branch can be corrected before retrying readiness.
- Do not broaden the docs into claiming this happens on every patch-mode commit or every agent iteration; it is specific to the draft-to-ready transition.

## Tasks

- [ ] Update `docs/workflows.md` anywhere the patch-mode or plan-mode readiness path is summarized so the diagrams/text mention the pre-ready `check:fix` step.
- [ ] Update `docs/worktrees-and-commits.md` in the draft PR lifecycle or readiness discussion so it explains that Jarvis may rewrite files with `bun run check:fix` immediately before running `bun run ready` and flipping the PR out of draft.
- [ ] Keep wording aligned with subspec 00's final behavior and avoid implying any broader pre-commit or per-iteration fixer automation.

## Acceptance criteria

- [ ] `docs/workflows.md` describes the draft-to-ready sequence as `bun run check:fix` -> `bun run ready` -> `gh pr ready` for the harness paths that mark PRs ready.
- [ ] `docs/worktrees-and-commits.md` states that the readiness transition may mutate files via `check:fix` immediately before the final ready gate runs.
- [ ] The updated docs state that a `check:fix` or `ready` failure leaves the PR in draft instead of claiming readiness always succeeds once the spec is complete.
- [ ] The updated docs do not claim that `check:fix` runs before ordinary patch-mode commits or during every iteration.

## Documentation updates

- [ ] No additional documentation beyond `docs/workflows.md` and `docs/worktrees-and-commits.md` is required unless implementation reveals another existing readiness description that would otherwise become inaccurate.

## Out of scope

- README restructuring or broader script catalog edits.
- Re-documenting the full `ready` script internals beyond the new pre-ready fixer step.
