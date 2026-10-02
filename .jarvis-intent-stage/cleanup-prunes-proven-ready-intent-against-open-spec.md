---
name: cleanup-prunes-proven-ready-intent-against-open-spec
---

# Cleanup prunes a proven ready-intent while its plan spec is still open on the default branch

Unsplit rationale: open-spec ready-intent discovery, dry-run preview, archive-branch prune commits, and operator docs all live on the `jarvis cleanup` stranded/queue hygiene path in `v2/src/commands/cleanup*.ts`; no daemon, pipeline landing, or execution-loop seam changes.

## Primary implementation surface

- `v2/src/commands/cleanup.ts` (in-repo `ready-intents/` discovery, eligibility, dry-run, and apply via existing archive publication)

## Problem

Chained intent→plan pipelines land `ready-intents/<slug>.md` on the default branch and an open timestamped spec tree whose `intent.md` matches, but the plan stage cannot delete the queue file from `main` (plan branch base omits the path). Cleanup today prunes that file only when archiving a completed spec; until archive the queue entry looks actionable and `intent.md` drift can strand it forever.

## Decisions

- `jarvis cleanup` prunes `ready-intents/<slug>.md` when the repository default branch holds an open (not under `completed/`) spec directory for that slug whose `intent.md` is byte-identical, staging the deletion on the same isolated cleanup archive branch/PR path used for archival prunes.
- No byte match → no prune (unchanged safety); dry-run lists the prune like archival preview does today.
- Do not revive plan-worktree consumption (`consumeFrom: "source"`); it does not mutate `main`.

## Prerequisites

- Consumed ready-intent resolution matches slug-named `ready-intents/<slug>.md` against a spec tree's `intent.md` bytes (timestamp-prefixed spec directory names included).

## Acceptance criteria

- [ ] `cleanup.test.ts`: a ready-intent byte-identical to an open spec directory's `intent.md` on the default branch is pruned on apply and previewed on dry-run; fails against current code (archive-only prune).
- [ ] Same file: a non-identical ready-intent is kept.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md`: remove the claim that the plan PR removes the ready-intent from `main`; state that cleanup prunes a proven queue file once the matching open spec tree is on the default branch.
- `v2/docs/operator-runbook.md` § Cleanup: document stranded/open-home ready-intent prune timing (proven byte match against an open spec on the default branch, not only on archive).
