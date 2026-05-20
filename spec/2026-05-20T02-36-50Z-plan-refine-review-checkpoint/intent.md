---
name: plan-refine-review-checkpoint
---

Need to have a blocker after refinement and before draft. 

* This likely means we need a draft PR with just the intent.md after refinement.
* Need a blocker added to the intent.md at the end for reviewer to add their input. Maybe the final refinement turn adds this and guided questions? (as needed, 0 is ok)
* Need a --resume-draft or something on the cli to know where we are in the process and an entry point back into the loop with draft and review. 

## Refine turn 1

### Current pipeline

`jarvis plan` runs: refine phase → (if blocker: commit + stop, no PR) → rename worktree/branch to final name → commit refine → draft phase → commit draft → open draft PR → review phase → mark PR ready.

A refine-phase `## Blocker` today means "something unexpected is wrong; stop and wait." The user wants to turn it into a structured review checkpoint: the **last** refine turn should always append a `## Blocker` as a human-approval gate before drafting begins.

### Key files

| File | Role |
|---|---|
| `src/modes/plan/prompts/refine.md` | Agent prompt injected each refine turn; currently instructs `## Blocker` only for show-stoppers. |
| `src/modes/plan/refine.ts` | Orchestrates turns; returns `terminalOutcome: "blocker"` when `## Blocker` is present. |
| `src/commands/plan.ts` lines ~1201-1254 | When `refineBlocker !== undefined`: commits refine + blocker, pushes, prints blocker to stderr, then **stops without opening a PR**. |
| `src/commands/plan-args.ts` | `--resume` today validates that the path ends in `index.md` (which doesn't exist until after draft). No pre-draft resume entry point. |
| `src/commands/plan.ts` ~293 `prepareResume()` | Validates `--resume` path is `index.md` and branch exists on origin. |

### Proposed design

**A — Refine prompt update (`prompts/refine.md`)**
On the final allocated turn, if the intent is sufficiently refined, the agent must append `## Blocker` as a review-checkpoint (0 questions is valid; include guided questions only when genuinely useful). The heading contract and append-only rules already accommodate this — it already stops refine iteration. "Final turn" = when `turnsRemaining === 1`.

**B — Open a draft PR after the refine-blocker commit (plan.ts ~1201)**
When `refineBlocker !== undefined`, after the existing `commitPlanRefine` + `commitPlanBlocker` calls, call `ensureDraftPr` so the reviewer sees the intent on GitHub. The PR body at this point will use `buildPlanPrHeader` without an `index.md` — that function degrades gracefully to `# Plan: <name>` plus the intent/index file bullets.

**C — Resume entry point for pre-draft state**
Extend `parsePlanArgs` / `prepareResume` to accept `spec/<name>/intent.md` (in addition to `index.md`) as the `--resume` argument. Detection: if the path basename is `intent.md` and no sibling `index.md` exists, treat it as a pre-draft resume. This avoids a new flag and keeps the UX simple (`jarvis plan --resume spec/.../intent.md`).

**D — Pre-draft resume flow (plan.ts)**
When resume detects a pre-draft state (intent.md path, no index.md):
1. Strip the `## Blocker` section from intent.md in memory before passing it to the draft phase (so the draft agent isn't confused by the checkpoint text; the blocker remains on disk/in git history as is).
2. Skip the refine phase entirely (acts like `--refine-turns 0`).
3. Run draft phase → commit draft → open/update draft PR → run review → mark PR ready.

### Scope boundaries

- The `--resume` flag with `index.md` path continues to work exactly as today (review-only resume).
- `refineTerminalOutcome === "blocker"` in the non-resume path already sets up everything correctly; the only additions are (B) open PR and (C)/(D) add the resume path.
- `commit: false` (no-commit external specs) is out of scope for this feature — those skip the PR flow entirely.
- The blocker text is not stripped from the committed `intent.md`; it's only excluded from the in-memory string passed to the draft agent prompt.

## Blocker

Intent is sufficiently refined and ready for drafting. Reviewing before the spec is written.

The following are notes for the drafter, not questions requiring human answers:

- Confirm the exact insertion point for `ensureDraftPr` in the refine-blocker path: after `commitPlanBlocker` returns (line ~1232) and before `safeUpdatePrBody` (which can be removed from this branch — `ensureDraftPr` sets the body via `bodyGenerator`). Both commits already push to origin (`commitPlanRefine` with `firstPush: true`, `commitPlanBlocker` with `firstPush: false`) so the branch is on origin when `ensureDraftPr` is called.
- `renderAttribution` will return `""` in the blocker path (no subspec commits yet), so `footer` is the empty string. That's fine.
- `planBranch` and `baseBranch` are not pre-computed variables at line 1202; use `` `plan/${planName}` `` and `getCurrentBranch(project.root)` inline, matching the existing `safeUpdatePrBody` call at line 1235.
- Add `assertResumeIntentPath(specPath: string): { planName, specDirBasename }` alongside `assertResumeIndexPath` — same logic but requires `basename === "intent.md"`. Add `preDraft: boolean` to `ResumePrep`. In `prepareResume`, branch on `basename(args.specPath)`: if `"intent.md"` call the new function and skip the `index.md` existence check (verify instead that `index.md` does NOT exist). If `"index.md"` continue the existing path.
- In `planCommand`'s resume block (line ~551), after `prepareResume`, check `resume.preDraft`. If true: set `planName`, `specDirBasename`, `worktreePath`, `planBranch`, `baseBranch` from the resume struct, then fall through to the draft phase (skip refine entirely — `refineTurns` defaults to 0 in the resume path already at line 561). Strip the `## Blocker` section from the on-disk `intent.md` in memory before building the draft prompt; add `export function stripBlockerSection(content: string): string` to `src/modes/plan/blocker.ts` using the existing index-finding logic in `detectBlocker`.
- The pre-draft resume path does NOT use an `r<n>` suffix on draft/review commits — it's the first time those phases run.
- `--resume` validation at line 562: `if (reviewPasses === 0 && refineTurns === 0)` guard must not block pre-draft resume since it legitimately has neither (it needs draft+review instead). Gate this check with `!resume.preDraft` or skip it entirely when `preDraft` is true.
- `refine.md` prompt update: add a conditional block just before the Instructions section: "**Final-turn checkpoint**: When `Turns remaining` is `1` and the intent is clear enough to draft, append `## Blocker` as a human-approval gate (not `## Refine skip`). Include guided questions only when something genuinely needs human input before drafting — zero questions is valid and typical."