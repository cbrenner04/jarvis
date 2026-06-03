---
name: patch-review-loop
---
# Intent: review & update flow in `jarvis1 run`

Add a self-review / refinement loop to patch mode (`jarvis1 run`), mirroring
the existing plan-mode self-review phase. Once the active spec checklist is
satisfied and Jarvis would normally hand off to `gh pr ready`, the flow is:

1. **Do N times**: run one agent-driven review-and-update pass over the work on
   the patch branch — the agent critiques the diff and rewrites
   code/tests/docs in place — and commit the pass.
2. **End** the loop.
3. **Mark the PR ready**.

Review passes use their own model configuration, distinct from the
implementation (patch) models — see "Review models" below.

## Why

- Patch mode currently stops the moment every `- [ ]` is ticked and the
  worktree is clean. There is no built-in opportunity for the agent (or a
  fresh agent) to step back and critique the diff against the spec.
- Plan mode already proves the pattern works: `prompts/plan/review.md` plus
  `plan: review <N>` commits, governed by `--review-passes`, with subtractive
  bias and blocker handling. We want the same shape on the implementation
  side.
- "A couple rounds should do." The goal is a light pass for obvious issues
  (dead code, missing tests, stale docs, divergence from the spec's
  acceptance criteria), not a heavyweight verification stage.

## Rough shape

- New phase in `jarvis1 run`, after the checklist is complete and the worktree
  is clean. Gate ordering: run the readiness gate (`bun run ready`) once to
  establish a green baseline, then the review passes, then the existing
  full ready transition (`bun run ready` → commit `check:fix` → `gh pr ready`).
  No per-pass validation (that would boil the ocean); the two gates bracket the
  loop instead.
- The pre-review baseline gate is **not** `maybeMarkReady` (which would mark the
  PR ready too early). It needs its own helper that runs `bun run ready`,
  commits and pushes any `check:fix` output, leaves the PR draft, and guarantees
  a clean worktree before pass 1 — i.e. `maybeMarkReady` minus the `gh pr ready`
  step. The post-review gate is the existing `maybeMarkReady`.
- Configurable number of passes via `modes.review.passes` (default `2`, matching
  plan). `0` skips the phase entirely — current behavior.
- Each pass = one non-interactive agent invocation. The agent gets:
  - The final spec tree (`index.md` + all subspecs, including ticked
    acceptance criteria).
  - The full diff for the branch against its PR/base comparison range so it
    can critique the exact change set headed for review.
  - A short review prompt living in `prompts/patch/review.md` that mirrors
    the wording and rules of `prompts/plan/review.md` — subtractive bias,
    keep changes scoped to the spec, raise a blocker only under a very
    limited set of conditions. The active spec tree (`index.md` + linked
    subspecs) is **read-only** during review: passes must not edit any spec
    file — not the checklist, not prose, docs sections, or acceptance text.
- Each successful pass that modifies files results in one harness commit on
  the patch branch (e.g. `review N` analogous to `plan: review N`), with the
  usual `Jarvis-Agent:` trailer and PR-body refresh. A no-op pass commits
  nothing and is logged.
- Blocker handling: blockers can be raised only under very limited conditions.
  On a blocker, the harness posts a PR comment (net-new `gh pr comment` helper)
  calling it out, commits whatever the pass changed, leaves the PR draft, and
  exits with the blocker exit code (`7`). No `## Blocker` file writes. The PR is
  guaranteed to exist by review time (the run exits earlier if PR
  creation was skipped or failed), so no PR-absent branch is needed. A failed
  comment post is a generic error (no new exit code, no special handling). No
  dedup: patch runs are fresh each invocation, so re-running after the blocker
  is fixed won't re-post; a re-hit of the same blocker re-posting is acceptable.
- Quota: if every agent in the review order is exhausted mid-phase, the run
  exits `2` (same as patch-mode exhaustion) and the PR stays draft — never
  auto-readied on quota. No mid-phase fall-through to a different mode's agents.

### Review models

- Review passes must be able to use **different models than the implementation
  (patch) models**. Add a config surface for this now in v1 — do not wait on
  the larger v2 model/agent rework (see the `separate-models-from-agents`
  intent), which is taking too long.
- Add a top-level `review` mode block, sibling to `modes.plan` and
  `modes.patch`: `modes.review` with its own `agentOrder` (`{ agent, model }[]`)
  and `passes` count. Review passes select their agent via the existing fallback
  semantics but from `modes.review.agentOrder`. When unset, fall back to
  `modes.plan.agentOrder` (review is critique work, closer to plan than patch).
  `modes.review.agentOrder` runs through the **same `validateAgentOrder`
  contract as `modes.patch`/`modes.plan`** at load — no stricter, no looser — so
  an entry valid for patch/plan is valid for review and a bad one fails at load,
  not as a runtime cost/telemetry break.
- Keep it minimal and additive; this is a stopgap that the eventual v2 model
  categories can subsume.

## Open questions to resolve while drafting

- CLI surface: a `--review-passes <n>` flag mirroring plan mode, plus the
  `modes.review` config above.
- Telemetry: review attempts emit invocation rows with a new
  `patch_phase: "review"` (or similar) so end-of-run summaries can show
  review cost alongside implementation cost without double-counting.

## Acceptance criteria (rough, for the eventual subspecs to refine)

- `jarvis1 run` performs N review passes (default 2 via `modes.review.passes`,
  flag-overridable, `0` opts out) after the checklist is complete and the
  worktree is clean. Gate ordering: `bun run ready` (baseline) → passes →
  `bun run ready` (re-validate) → `gh pr ready`.
- Each pass invokes one agent from `modes.review.agentOrder` (falling back to
  `modes.plan.agentOrder` when unset), with a prompt derived from a new
  `prompts/patch/review.md` template that inlines the spec tree and the branch
  diff. `modes.review.agentOrder` is priced-model-validated at load like the
  other mode orders.
- Each non-empty pass commits as `review <N>` (or equivalent harness
  subject) on the patch branch with the standard `Jarvis-Agent:` trailer
  and the standard attribution-footer PR-body refresh (footer only — it does
  not regenerate the model-authored description); empty passes do not commit.
- A blocker (raised only under very limited conditions) stops the loop, posts a
  PR comment calling it out, commits the pass's work, leaves the PR draft, and
  exits with the existing blocker exit code (`7`) — no new exit codes, no
  `## Blocker` file writes.
- Review-agent quota exhaustion mid-phase exits `2` and leaves the PR draft.
- Telemetry rows for review invocations are distinguishable from
  implementation iterations in `~/.jarvis/runs.jsonl` and in the end-of-run
  summary; cost and tokens are aggregated without double-counting.
- Docs updated:
  - `v1/docs/run-loop.md` — new "Review phase" section, updated exit-code
    table if needed, updated end-of-run summary description.
  - `v1/docs/workflows.md` — patch-mode diagram includes the review loop.
  - `v1/docs/config.md` — new top-level `modes.review` block
    (`passes` + `agentOrder`) documented.
  - `README.md` — short mention in the run flow overview.
  - `prompts/patch/review.md` — new prompt file checked in.
  - `v2/docs/v1-behaviors.md` (and any other v2 reference docs that
    enumerate v1 behaviors) — record this as a v1-side capability that v2
    must account for, since it is landing in v1 first.

## Out of scope

- Auto-merging the PR. Humans still merge.
- Running an external linter or test suite as part of the review prompt —
  `bun run ready` already runs them as the gate.
- Changing plan-mode review behavior.
- Multi-agent collaboration within a single review pass. One agent per pass,
  same fallback semantics as the rest of patch mode.

## Refinement

- Blockers can be raised only under very limited conditions; on a blocker the harness posts a PR comment calling it out and exits — do not write `## Blocker` to any spec file.
- Patch review runs only when effective `git` is `true`; do not invent a loop-only (`git: false`) review phase because loop-only mode has no patch branch, review commits, PR diff, or `gh pr ready` handoff.
- Review diff input uses the branch's PR/base comparison range; do not switch between `main` merge-base and a separate push-only base because the agent should critique the exact change set headed for review.
- Configured review passes run through pass `N` unless a blocker/quota/error stops the run; do not short-circuit on the first no-op pass because `--review-passes` should bound cost predictably like plan review.
- Review passes are a separate post-completion budget and do not consume `maxIterations`; do not exit `5` after the checklist-closing implementation iteration just because review pass count would exceed the patch-loop cap.
- The flow is strictly ordered: do N review-and-update passes, then end the loop, then mark the PR ready; do not interleave the ready handoff with the passes or mark ready before all N (or a stopping condition) complete.
- Review config is a top-level `modes.review` block (sibling to `modes.plan`/`modes.patch`) with its own `agentOrder` and `passes`, falling back to `modes.plan.agentOrder` when `agentOrder` is unset (review is critique work, closer to plan than patch); landed in v1 now. Do not reuse the patch implementation models for review and do not defer this to the v2 model/agent rework.
- `modes.review.agentOrder` runs through the same `validateAgentOrder` contract as `modes.patch`/`modes.plan` at load — no stricter, no looser; do not invent a review-only rule that rejects model paths patch/plan accept (e.g. blanket-rejecting `cost_source: "no-price"`), and do not skip validation so a bad entry breaks at runtime instead of load.
- The readiness gate brackets the review loop: `bun run ready` runs once after completion (green baseline), then the passes, then `bun run ready` again, then `gh pr ready`; do not validate between every pass (boils the ocean) and do not mark the PR ready on unvalidated review output.
- The pre-review baseline gate is its own helper (`maybeMarkReady` minus the `gh pr ready` step): it runs `bun run ready`, commits and pushes any `check:fix` output, leaves the PR draft, and guarantees a clean worktree before pass 1; do not reuse `maybeMarkReady` for it (marks the PR ready too early) and do not call only `bun run ready` (leaves `check:fix` mutations uncommitted/dirty going into pass 1).
- The active spec tree (`index.md` + linked subspecs) is read-only during review: passes must not edit any spec file — not the checklist, not prose, docs sections, or acceptance text; do not narrow this to "checklist only" because prose/criteria edits undermine the review input and drift later index/PR-body rendering.
- On a blocker the harness posts a `gh pr comment` (net-new helper) and exits `7`; the PR is guaranteed to exist by review time (the run exits earlier if PR creation was skipped/failed), a failed comment post is a generic error with no new exit code, and there is no dedup because patch runs are fresh per invocation.
- Review-agent quota exhaustion mid-phase exits `2` (mirroring patch-mode exhaustion) with the PR left draft; do not fall through to another mode's agents and do not auto-ready on quota.
- The per-pass PR-body refresh is only the standard attribution-footer re-render every commit already performs; it does not regenerate the model-authored description ([[restore-useful-pr-descriptions]] / #176 owns that block inside the narrative markers), so there is no collision.

## Refine skip

No net-new load-bearing decision found beyond the existing `## Refinement` ledger.
