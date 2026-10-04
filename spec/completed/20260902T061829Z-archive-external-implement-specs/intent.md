---
name: archive-external-implement-specs
---

# Archive external implement specs

## Primary implementation surface

Persistence.

## Problem

Cleanup derives durable spec identity from repository-relative run paths and scans only in-repo `v2/spec/`, so a completed external implement tree cannot be found or archived from its Jarvis-owned home.

## Prerequisites

- Shared `projectSafeId` maps registered project keys to the path segment used by git-disabled plan publication under `~/.jarvis/specs/<safeId>/plans/<name>/`.
- Implement CLI admission resolves a registered `plan.commit: false` external plan index to its owning project, preserves its canonical external identity, skips target-base membership for that tree, and completes preflight without materializing finished work.
- Implement execution routes, ticks, reviews, and completes the admitted external tree in place while all code, commits, publication, and gates stay on the ordinary worktree.
- Pipeline implement dispatch normalizes a git-disabled plan artifact to the same admitted external index and registered code project/base used by standalone implement.

## Decision ledger

- Treat the recorded admitted external spec identity as the cleanup source of truth for standalone and chained runs; rules out reconstructing it relative to the implementation worktree or repository.
- Discover only immediate open plan directories under `~/.jarvis/specs/<projectSafeId>/plans/` for the owning registered `plan.commit: false` project; rules out scanning unrelated Jarvis storage or claiming another project's home.
- Reuse criteria completeness, open-PR, materialized-owner, dry-run, move, and rollback guards before archival; rules out a weaker external cleanup path.
- Archive an eligible external plan directory to the `completed/` sibling within its external `plans/` home; rules out moving it into the repository or the external-home root.
- Preserve repository spec cleanup behavior and never prune an unrelated external ready-intent; rules out coupling external plan archival to in-repo intent consumption rules.

## Acceptance criteria

- [ ] Cleanup resolves an external spec from a durable standalone or chained implement run without rebasing the absolute path onto the code worktree or repository; it fails against the pre-fix identity filter.
- [ ] Cleanup discovers completed open external plan directories for registered `plan.commit: false` projects and ignores `completed/`, unrelated safe IDs, and non-plan external directories.
- [ ] Dry-run reports `plans/<name> -> plans/completed/<name>` without mutation, and apply performs that move only after the ordinary completeness, open-PR, and ownership rechecks pass.
- [ ] Failed external archival restores the source and reports the refusal under the existing transactional contract.
- [ ] Existing in-repo retired-artifact and stranded-artifact cleanup tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — define external spec archival as the terminal artifact lifecycle and cross-link cleanup operations.
- `v2/docs/operator-runbook.md` — document external-home cleanup discovery, dry-run, refusal, and `plans/completed/` destination.
- `v2/docs/v1-behaviors.md` — record the resulting v2 external-spec archival parity/difference without changing v1.

## Out of scope

- Homestead's downstream migration, external ready-intent cleanup, multi-project external homes, and v1 changes.

## Downstream follow-up

- After the full external-implement path ships, trigger a separate homestead-service migration from its gitignored/external split to the external-home flow.
