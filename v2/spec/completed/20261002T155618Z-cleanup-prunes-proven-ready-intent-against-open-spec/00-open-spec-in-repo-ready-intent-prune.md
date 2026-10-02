# 00 - Open-spec in-repo ready-intent prune

## Problem

Intent→plan pipelines land `ready-intents/<slug>.md` on the default branch and an open spec tree whose `intent.md` matches, but the plan stage cannot delete the queue file from `main`. Cleanup prunes a byte-identical consumed ready-intent only inside in-repo spec archival (`archiveCompletedSpec` / completed stranded archive), so the queue entry stays actionable until archive and `intent.md` drift can strand it indefinitely.

## Decisions

- Discover in-repo queue candidates with an explicit default-branch scan of Markdown files directly under `<plan.targetDir>/ready-intents/` (same skip rules as external queue discovery: files only, dot-entries ignored); rules out admitting queue paths through open spec-directory stranded discovery or archival completeness gates.
- For each candidate, admit prune eligibility only when `resolveConsumedReadyIntent` finds a byte-identical `intent.md` in a spec directory that exists open under the registered home on the repository default branch at `HEAD` (not under `completed/`); rules out archive-completion-only timing and rules out filename-only deletion.
- Apply eligible prunes through `publishConsumedReadyIntentOnly` on the existing per-project cleanup archive branch/worktree; rules out in-place operator-checkout mutation and rules out requiring a spec `git mv` to `completed/` in the same commit.
- `--dry-run` previews eligible prunes with the same stranded queue preview shape as external consumed ready-intents (`prune: ready-intents/…` with consumer context when useful); rules out silent apply-only behavior.
- No matching bytes → skip with an explicit unconsumed reason; rules out sweeping unrelated queue files.
- Do not revive plan-worktree landing consumption (`consumeFrom: "source"`) to remove the queue file from `main`; rules out plan PR/worktree deletion as the main hygiene path.

## Tasks

- Add default-branch in-repo `ready-intents/` discovery and inspection wired into `discoverStrandedArtifacts` / `inspectStrandedArtifacts` / stranded apply (reuse `resolveConsumedReadyIntent`, `previewArtifact`, `archiveArtifactSpec` or equivalent queue branch calling `publishConsumedReadyIntentOnly`).
- Extend `cleanup.test.ts` with fixtures: open spec on the default branch, slug-named ready-intent on the default branch, no archival prerequisite; cover dry-run preview, apply prune on the cleanup archive branch, and a differing-bytes control.
- Update operator-facing docs listed below.

## Acceptance criteria

- [x] `cleanup.test.ts` test `dry-run previews and apply prunes in-repo ready-intent proven by open spec on default branch` proves `--dry-run` lists the ready-intent prune and apply commits `git rm` of the queue file via the cleanup archive branch while the open spec tree stays under the home root; it fails against the pre-fix archive-only prune path.
- [x] `cleanup.test.ts` test `leaves in-repo ready-intent when bytes differ from open spec intent.md` proves a non-identical queue file is not previewed for prune and survives apply.
- [x] `cleanup.test.ts` test `dry-run previews and apply prunes the slug-named consumed ready-intent` stays green (completed-spec archival prune unchanged).
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record that in-repo consumed ready-intent prune also runs on proven byte match against an open spec on the default branch, not only on archive.
- `v2/docs/first-workflow-walkthrough.md` § Inter-stage handoff — remove the claim that the plan PR removes the ready-intent from `main`; state that `jarvis cleanup` prunes a proven queue file once the matching open spec tree is on the default branch.
- `v2/docs/operator-runbook.md` § Cleanup: eligibility gate — document in-repo stranded/open-home ready-intent prune timing (byte match to an open spec on the default branch, cleanup archive branch publication, not archive-only).
