---
name: no-commit-preserve-finalized-spec-on-failure
---

# No-commit finalized specs survive later failures

## Prerequisites

- No-commit intent draft prints the finalized external `intent.md` path after naming succeeds.

## Problem

No-commit cleanup removes the current external spec directory on later phase failures. Once intent draft has renamed `tmp-*` to the final spec name, that cleanup can delete the operator-owned `intent.md` artifact.

## Desired behavior

- A successfully named no-commit external spec directory is preserved on later refine, draft, review, validation, quota, model-config, interrupt, or generic errors.
- Failure output includes the preserved external spec directory path when cleanup is skipped.
- Cleanup still removes abandoned pre-intent `tmp-*` external spec directories when intent draft or pre-naming setup fails.
- Committed plan cleanup behavior is unchanged.

## Decisions

- Treat a named external spec directory as operator-owned; rule out deleting it as failed-run temp state.
- Limit automatic no-commit cleanup to abandoned `tmp-*` directories; rule out removing finalized spec directories on phase failure.
- Report the preserved spec directory on failure; rule out relying only on prior stdout breadcrumbs.

## Acceptance signals

- A regression test covers `commit: false` refine failure after intent drafting: the named external spec directory and `intent.md` remain on disk.
- A regression test covers a later draft or review failure preserving the named external spec directory.
- Existing intent-draft failure cleanup still removes abandoned `tmp-*` external spec directories.
- Failure output includes the preserved external spec directory path when cleanup is skipped.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update `v1/docs/plan-mode.md` to say no-commit specs are preserved external artifacts after intent drafting succeeds, including on later phase failure.
- Update plan-mode troubleshooting or cleanup text that describes where to find a failed no-commit spec.
- Update `v2/docs/v1-behaviors.md` for the changed v1 plan-mode failure behavior.

## Out of scope

- Changing `jarvis1 cleanup` to manage external no-commit specs.
- Changing committed/in-repo plan spec cleanup.
- Reworking v2 `jarvis intent` or ready-intent flow.
