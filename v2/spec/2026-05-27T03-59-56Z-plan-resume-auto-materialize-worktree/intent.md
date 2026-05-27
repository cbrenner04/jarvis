---
name: plan-resume-auto-materialize-worktree
---
# Auto-materialize plan worktree on `jarvis1 plan --resume`

## Problem

Resuming work across machines breaks for plan mode. `jarvis1 plan --resume` / `--resume-draft` throws `plan worktree missing at .worktree/plan-<name>` (v1/src/commands/plan.ts:381) when the worktree dir is absent locally, even though the `plan/<name>` branch may exist on origin.

Patch mode already handles this in `ensureWorktree` (v1/src/worktree.ts:23) by recreating the worktree from a local or origin branch. PR #159 added equivalent behavior for `jarvis1 review-feedback` via `ensurePatchWorktreeForExistingBranch`. Plan `--resume` is the remaining gap.

## Desired behavior

When `jarvis1 plan --resume <index>` or `--resume-draft <intent>` runs and the plan worktree dir is missing, auto-materialize it from the `plan/<name>` branch (local or `origin/plan/<name>`), then continue resume.

If neither the local nor origin branch exists, fail with the current "worktree missing" semantics — there is nothing to resume.

## Scope notes

- Only `--resume` / `--resume-draft` with `commit: true` (the only path that hits line 381). No-commit plans don't use a worktree.
- Reuse the helper shape from `ensurePatchWorktreeForExistingBranch`, parameterized for the `plan-<name>` dir / `plan/<name>` branch naming, OR generalize it. Implementer's call — single shared helper is preferred.
- Best-effort `git fetch origin` before checking remote branch existence (matches existing helpers).
- Log the recreation: `plan: recreated worktree at <path> from <local|origin>`.
- After materialization, the existing branch / file checks on lines 385-399 still run unchanged.

## Acceptance hints

- Unit test: worktree dir missing, `plan/<name>` branch exists locally → worktree recreated, resume proceeds.
- Unit test: worktree dir missing, only `origin/plan/<name>` exists → branch created from origin, worktree recreated, resume proceeds.
- Unit test: worktree dir missing, no local or origin branch → throws (preserve current error or close variant).
- Unit test: worktree dir present → existing path unchanged (no fetch, no recreate side effects).
- Update `v1/docs/plan-mode.md` and `v1/docs/v1-behaviors.md` (whichever covers resume) to note the auto-materialize behavior.

## Out of scope

- Changing patch `ensureWorktree` or `review-feedback`'s helper — both already work.
- Cross-machine state beyond the worktree itself (session logs, ledgers, etc.).
- No-commit plan resume.

## Refinement

- Resume auto-materialization does not relax the later `origin` requirement; when `plan/<name>` exists only locally, recreate the worktree if possible, then preserve the existing `plan branch plan/<name> is not on origin; cannot resume` failure from the unchanged post-checks.
- Logging is recreate-only; emit `plan: recreated worktree at <path> from <local|origin>` only after successful materialization, and emit nothing on the already-present fast path.
- Shared-helper shape should surface source as data (`{ path, source }` or equivalent) so plan resume and review-feedback can own their own user-facing log lines without duplicating branch-provenance checks.
- Helper must create the `.worktree/` parent when needed before `git worktree add`; plan resume should inherit that behavior rather than open-code a second mkdir path.
- Preferred implementation is one shared "existing branch only" helper plus a thin plan-specific wrapper or call site that passes `plan-` / `plan/` naming; do not add a third near-duplicate branch/worktree recreation flow.
- Test the local-only branch case twice: missing worktree plus local branch plus no remote recreates the worktree, then still fails on the preserved origin check; missing worktree plus local branch plus remote succeeds end-to-end.
- Guard helper invocation in `prepareResume` behind the existing `existsSync(worktreePath)` miss path; the shared helper fetches before branch checks, so calling it on the hit path would violate the required no-fetch/no-recreate fast path.
- Update the behavior-catalog target to `v2/docs/v1-behaviors.md`; `v1/docs/v1-behaviors.md` does not exist, so the same change window must align `v1/docs/plan-mode.md` plus the v2 parity catalog.

## Refine skip

No net-new refinement on this pass.

## Blocker

Review and approve `v2/spec/2026-05-27T03-59-56Z-plan-resume-auto-materialize-worktree/intent.md` before drafting subspecs.

Optional feedback:
- Add missing constraints, assumptions, and risks directly in `intent.md`.
- If scope is unclear, append focused questions to this blocker section.

Resume drafting once approved:
`jarvis1 plan --resume-draft v2/spec/2026-05-27T03-59-56Z-plan-resume-auto-materialize-worktree/intent.md`
