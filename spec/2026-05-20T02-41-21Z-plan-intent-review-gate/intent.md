---
name: plan-intent-review-gate
---

Need to have a blocker after refinement and before draft. 

* This likely means we need a draft PR with just the intent.md after refinement.
* Need a blocker added to the intent.md at the end for reviewer to add their input. Maybe the final refinement turn adds this and guided questions? (as needed, 0 is ok)
* Need a --resume-draft or something on the cli to know where we are in the process and an entry point back into the loop with draft and review. 

## Refine turn 1

### Current flow (what already exists)

When a refine agent appends `## Blocker` to `intent.md`, the harness already:
1. Commits the refine changes (`plan: refine`)
2. Commits a `plan: blocker` commit
3. Pushes both to the plan branch and opens a draft PR
4. Exits with code 1

So the **PR-with-intent-only** checkpoint already happens naturally whenever the refine agent raises a blocker. The missing pieces are: (a) a signal to make the final refine turn *intentionally* raise this review-gate blocker rather than only doing so when it genuinely needs info, and (b) a CLI entry point to resume from that state into draft + review.

### Scope decisions

**Post-refine review gate (the blocker)**
- The refine prompt already allows/requires appending `## Blocker` when human clarification is needed. This feature extends that contract: the final refine turn should also add a `## Blocker` when the intent is "ready for human sign-off" — i.e., refined enough that drafting can proceed once approved, but the operator wants a checkpoint.
- The blocker body should include guided questions derived from the intent (e.g. scope uncertainties, open decisions) — "0 questions is OK" means if the intent is fully clear, the blocker section can simply say "Intent looks complete — approve to proceed to draft."
- This is opt-in behavior controlled by a new config flag (e.g. `modes.plan.requireIntentApproval: true`) or a CLI flag (`--require-intent-approval`). When off, the current direct-to-draft path is unchanged.

**The `--resume-draft` entry point**
- Takes the path to `intent.md` (not `index.md`, which doesn't exist yet): `jarvis plan --resume-draft spec/<name>/intent.md`
- Preconditions: worktree exists on `plan/<name>`, worktree is clean, `intent.md` exists and does **not** contain an uncleared blocker (the human is expected to have removed or resolved the `## Blocker` section before running this command, OR we read the blocker as a signal that it was the review-gate kind and proceed anyway — needs a decision).
- The command runs: draft phase → review passes → opens/updates the existing draft PR → marks it ready.
- Commit subject pattern: `plan: draft` and `plan: review N` — same as the normal fresh-plan path, so telemetry and PR body generation are reused without change.
- `computeResumeCounters` and `prepareResume` need a variant (or extension) that doesn't require `index.md` to already exist.

**Open question (decide in draft)**
When the human runs `--resume-draft`, should it:
- **(A) Require the human to have deleted `## Blocker` from intent.md** before running, and fail if the blocker is still present (cleaner signal that human actively approved)?
- **(B) Proceed regardless of whether `## Blocker` is still in intent.md** (simpler — treat running the command itself as approval)?
Option A is safer; Option B is more ergonomic. Draft spec should pick one.

### Files most likely to change
- `src/commands/plan-args.ts` — add `--resume-draft` flag
- `src/commands/plan.ts` — new `resumeDraft` branch in `planCommand`, new `prepareResumeDraft` helper
- `src/modes/plan/refine.ts` — possibly extend prompt/instructions for the review-gate blocker path
- `src/config.ts` — optional `requireIntentApproval` config key
- `docs/plan-mode.md` — document the new flag and workflow

## Refine turn 2

### Tightened product decision

Pick **Option A** for `--resume-draft`: require the human to clear the `## Blocker` section from `intent.md` before resume succeeds.

Why this fits the existing harness better:
- Current blocker semantics everywhere else mean "stop until the spec is edited to resolve the blocker." Reusing that contract keeps resume behavior unsurprising.
- It gives a concrete, reviewable approval artifact on the branch: the reviewer either deletes the review-gate blocker or replaces it with updated intent text before draft begins.
- It avoids needing to classify blocker intent ("review gate" vs genuine missing information) inside the harness. `detectBlocker()` can stay simple: any remaining blocker means do not proceed.

### Scope boundary to keep the draft spec small

This feature should treat the approval gate as a **refine-phase stop condition only**. It should not change blocker handling during draft or review, and it should not introduce a general notion of typed blockers or blocker metadata.

That implies:
- The final refine turn needs a way to know "append a sign-off blocker now" when approval is required and no genuine blocker was found.
- Resume-from-intent only needs to support the existing committed-plan path (`modes.plan.commit: true`), matching normal `--resume` assumptions.
- PR behavior should reuse the current refine blocker flow: `plan: refine`, then `plan: blocker`, draft PR remains open, exit non-zero.

### Likely implementation split

The draft spec should probably separate:
- CLI and preflight work: parse `--resume-draft`, accept `intent.md` instead of `index.md`, validate clean worktree/current branch/remote branch, and fail if `intent.md` still contains `## Blocker`.
- Refine gate behavior: add an explicit signal for "this is the last refine turn and intent approval is required", then have the refine prompt append a review-gate blocker with either guided questions or an approval message.
- Docs/config surface: decide whether approval is enabled by CLI flag only for the first cut, or whether config support is worth the extra scope.

### Recommended first-cut constraint

Prefer **CLI flag first, config later** unless there is a strong repo-local reason to persist this behavior in config now.

Reasoning:
- `src/config.ts` and plan flag resolution already carry meaningful complexity from recent `modes.plan.*` options.
- A one-off operator checkpoint is naturally invocation-scoped.
- The design is easier to validate if the first version is explicit: `jarvis plan --require-intent-approval ...`, then `jarvis plan --resume-draft spec/<dir>/intent.md`.

If config support stays in scope, it should be specified as precedence rather than an independent behavior:
- CLI flag overrides config.
- Config only affects the refine-to-draft transition on fresh plan runs, not normal `--resume`.

## Refine turn 3

### CLI shape needs to avoid colliding with existing file-mode parsing

`docs/plan-mode.md` already documents `jarvis plan spec/<spec-dir>/intent.md` as a **fresh authoring input**. That means resume-from-intent should stay behind an explicit mode switch such as:
- `jarvis plan --resume-draft spec/<spec-dir>/intent.md`

The draft spec should avoid any design that makes bare `jarvis plan <intent.md>` context-sensitive based on whether a worktree already exists, because that would blur two different workflows:
- create a brand-new plan from an intent file
- resume an already-open plan PR from a refine-phase approval gate

### Preflight and helper split should stay narrow

Current code already has the right seam: `prepareResume()` centralizes branch/worktree/cleanliness checks, but it currently asserts `index.md` and therefore assumes draft already happened. The smallest extension is a sibling path for intent-gated resumes that:
- accepts `intent.md`
- reuses the same `plan/<name>` branch and `.worktree/plan-<name>/` lookup
- reuses `computeResumeCounters()` unchanged so later `plan: review N` numbering stays consistent
- adds one new preflight: fail if `intent.md` still contains `## Blocker`

This keeps the feature additive instead of turning normal `--resume` into a polymorphic dispatcher over both pre-draft and post-draft states.

### Recommended out-of-scope items for the first draft spec

To keep the implementation bounded, the first spec should explicitly avoid:
- support for `modes.plan.commit: false`
- typed blocker metadata or parsing different blocker kinds
- auto-removing or rewriting the blocker during resume
- extending ordinary `--resume` to accept `intent.md`

That leaves a crisp first cut: one explicit flag to force a review-gate blocker at the end of refinement, one explicit flag to resume from the approved `intent.md`, and docs that describe the manual approval step as "edit `intent.md` to clear the blocker, then run `--resume-draft`."
