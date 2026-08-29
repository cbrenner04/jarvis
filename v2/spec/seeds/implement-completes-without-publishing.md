---
name: implement-completes-without-publishing
---

# Standalone implement completes write+review but never publishes a PR

## Problem

`jarvis run workflow implement` runs its write and review/finalization steps to terminal `completed` (`loopOutcomeKind: complete`), commits the work to the managed branch, but **no publication step dispatches**: the branch is never pushed to `origin` and no draft PR is created. There is no error, no `ready_flip_failed`, no failed row — the workflow just ends after the finalization run (`intent_finalization` + `runtime_smoke_outcome`) with the branch local-only. The operator must push and open the PR by hand. Distinct from [[implement-publication-reuses-closed-same-branch-pr]] (which dispatches publication and fails at ready-flip).

## Evidence

- 2026-08-29, three standalone implements this session all ended local-only with no PR, hand-published: `retire-plan-mutation-checkpoint-authoring` (#3086), `execution-uses-lossless-git-status` 00-01 (#3087). Run chains show entry write + a finalization run carrying `runtime_smoke_outcome` — and no third run with push/`pr_created` events. Recurred on a freshly-bounced daemon, so it is not stale-daemon state.
- Contrast: the deferred-settlement implement (#3069) only published because the operator manually `jarvis run resume`d it, which drove a distinct publication run (that then hit ready-flip). No implement auto-published this session.

## Decisions

- Root-cause why the publication successor does not dispatch after a standalone implement's write/review chain settles `completed` (successor-dispatch gap vs. a workflow chain that omits the publication step vs. a silent publication failure). Rules out treating the manual `run resume` as the intended publish path.
- A standalone implement that settles `completed` with committed, unpushed work either publishes (push + draft PR) or settles a **named failure** the operator can see and act on — never a silent local-only terminal. Rules out the no-error strand.
- If publication is genuinely a separate operator step for standalone implement (not pipeline), the docs and `run list`/TUI must say so and name the publish verb. Rules out the current silent ambiguity.

## Acceptance criteria

- [ ] A standalone `run workflow implement` that completes its spec pushes the branch and opens a draft PR, OR settles a named, operator-visible failure — pinned by a test that fails against the current silent local-only completion.
- [ ] The publication successor's dispatch (or its absence) after a `completed` write/review chain is covered by a daemon/execution test proving it fires or explains why it does not.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — standalone implement publication contract: when a PR is created vs. when the operator must publish.
- `v2/docs/operator-runbook.md` — note the local-only-completion strand and the hand-publish recovery until fixed.
