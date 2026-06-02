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
  is clean, before `gh pr ready` and the readiness gate.
- Configurable number of passes via `modes.review.passes` (default `2`, matching
  plan). `0` skips the phase entirely — current behavior.
- Each pass = one non-interactive agent invocation. The agent gets:
  - The final spec tree (`index.md` + all subspecs, including ticked
    acceptance criteria).
  - The full diff for the branch vs. its merge-base on `main` (or the
    push-base) so it can see what actually shipped.
  - A short review prompt living in `prompts/patch/review.md` that mirrors
    the wording and rules of `prompts/plan/review.md` — subtractive bias,
    keep changes scoped to the spec, raise a blocker only under a very
    limited set of conditions, don't touch the spec checklist.
- Each successful pass that modifies files results in one harness commit on
  the patch branch (e.g. `review N` analogous to `plan: review N`), with the
  usual `Jarvis-Agent:` trailer and PR-body refresh. A no-op pass commits
  nothing and is logged.
- Blocker handling: blockers can be raised only under very limited conditions.
  On a blocker, the harness posts a PR comment calling it out, commits whatever
  the pass changed, leaves the PR draft, and exits with the blocker exit code.
  No `## Blocker` file writes.
- Quota / agent fallback all reuse existing patch-mode classification (no new
  error paths invented).

### Review models

- Review passes must be able to use **different models than the implementation
  (patch) models**. Add a config surface for this now in v1 — do not wait on
  the larger v2 model/agent rework (see the `separate-models-from-agents`
  intent), which is taking too long.
- Add a top-level `review` mode block, sibling to `modes.plan` and
  `modes.patch`: `modes.review` with its own `agentOrder` (`{ agent, model }[]`)
  and `passes` count. Review passes select their agent via the existing fallback
  semantics but from `modes.review.agentOrder`. When unset, fall back to
  `modes.patch.agentOrder`.
- Keep it minimal and additive; this is a stopgap that the eventual v2 model
  categories can subsume.

## Open questions to resolve while drafting

- Interaction with the readiness gate (`bun run ready`): readiness still
  runs after the last review pass. If review-induced edits cause `bun run
  ready` to mutate files (e.g., `check:fix`), the existing `chore: apply
  pre-ready check:fix` commit path handles it; we should not duplicate it.
- CLI surface: a `--review-passes <n>` flag mirroring plan mode, plus the
  `modes.review` config above.
- Telemetry: review attempts emit invocation rows with a new
  `patch_phase: "review"` (or similar) so end-of-run summaries can show
  review cost alongside implementation cost without double-counting.

## Acceptance criteria (rough, for the eventual subspecs to refine)

- `jarvis1 run` performs N review passes (default 2 via `modes.review.passes`,
  flag-overridable, `0` opts out) after the checklist is complete and the
  worktree is clean, before `gh pr ready`.
- Each pass invokes one agent from `modes.review.agentOrder` (falling back to
  `modes.patch.agentOrder` when unset), with a prompt derived from a new
  `prompts/patch/review.md` template that inlines the spec tree and the branch
  diff.
- Each non-empty pass commits as `review <N>` (or equivalent harness
  subject) on the patch branch with the standard `Jarvis-Agent:` trailer
  and triggers a PR-body refresh; empty passes do not commit.
- A blocker (raised only under very limited conditions) stops the loop, posts a
  PR comment calling it out, commits the pass's work, leaves the PR draft, and
  exits with the existing blocker exit code (`7`) — no new exit codes, no
  `## Blocker` file writes.
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
- Review config is a top-level `modes.review` block (sibling to `modes.plan`/`modes.patch`) with its own `agentOrder` and `passes`, falling back to `modes.patch.agentOrder` when `agentOrder` is unset; landed in v1 now. Do not reuse the patch implementation models for review and do not defer this to the v2 model/agent rework.

## Refine skip

No net-new load-bearing decision found beyond the existing `## Refinement` ledger.
