---
name: cleanup-prunes-proven-ready-intent-against-open-spec
---

# Cleanup prunes a proven ready-intent while its plan spec is still open on the default branch

Unsplit rationale: open-spec ready-intent discovery, dry-run preview, archive-branch prune commits, and operator docs all live on the `jarvis cleanup` stranded/queue hygiene path in `v2/src/commands/cleanup*.ts`; no daemon, pipeline landing, or execution-loop seam changes.

## Primary implementation surface

- `v2/src/commands/cleanup.ts` (default-branch in-repo `ready-intents/` admission, dry-run, orchestration)
- `v2/src/commands/cleanup-archive-publication.ts` and `v2/src/commands/cleanup-artifacts.ts` (reuse `resolveConsumedReadyIntent`; apply via `publishConsumedReadyIntentOnly` / cleanup archive branch)

## Problem

Chained intent→plan pipelines land `ready-intents/<slug>.md` on the default branch and an open timestamped spec tree whose `intent.md` matches, but the plan stage cannot delete the queue file from `main` (plan branch base omits the path). Cleanup today prunes that file only when archiving a completed spec; until archive the queue entry looks actionable and `intent.md` drift can strand it forever.

## Decisions

- In-repo `ready-intents/` is excluded from stranded `QUEUE_DIR_NAMES` discovery today; add an explicit default-branch scan of slug-named `ready-intents/<slug>.md`, admit each path only when `resolveConsumedReadyIntent` finds a byte-identical `intent.md` in an open (not under `completed/`) timestamped spec directory on the default branch — same slug-then-dirname resolution as archive prunes.
- Apply eligible open-spec prunes through `publishConsumedReadyIntentOnly` on the existing isolated cleanup archive branch/PR path (not archive-completion-only).
- No byte match → no prune (unchanged safety); dry-run lists the prune like archival preview does today.
- Do not revive plan-worktree consumption (`consumeFrom: "source"`); it does not mutate `main`.

## Prerequisites

- Committed `resolveConsumedReadyIntent` in `cleanup-artifacts.ts` already resolves slug-named `ready-intents/<slug>.md` against a spec tree's `intent.md` bytes (slug then dirname; timestamp-prefixed spec directory names included).

## Acceptance criteria

- [ ] `cleanup.test.ts`: a ready-intent byte-identical to an open spec directory's `intent.md` on the default branch is pruned on apply and previewed on dry-run; fails against current code (archive-only prune).
- [ ] Same new test(s): a non-identical ready-intent is kept.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: align cleanup ready-intent prune catalog with open-spec-on-default-branch timing (not archive-only).
- `v2/docs/first-workflow-walkthrough.md` § Inter-stage handoff (and any plan-PR-on-`main` cleanup claim): remove the claim that the plan PR removes the ready-intent from `main`; state that cleanup prunes a proven queue file once the matching open spec tree is on the default branch.
- `v2/docs/operator-runbook.md` § Cleanup: document stranded/open-home ready-intent prune timing (proven byte match against an open spec on the default branch, not only on archive).
