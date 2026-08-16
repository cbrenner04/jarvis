---
name: branch-scoped-pipeline-resume
---

# Cannot resume one fan-out branch's failed stage independently of sibling gates

## Problem

On a fanned-out pipeline, an operator cannot replay a single branch's failed stage without touching its siblings. `jarvis pipeline resume` takes only `{ pipelineId }` (`v2/src/commands/pipeline.ts` `runPipelineMutationCommand("pipeline_resume", { pipelineId }, ...)`) — it is whole-pipeline scoped, with no branch argument. Worse, when the pipeline's derived state is `awaiting-approval` (a sibling branch sits at an undecided gate), the daemon's `pipeline_resume` returns `missing_context` / `claim_refused` **without dispatching anything** (`daemon-pipeline-resume.test.ts`), so resume is a silent no-op even for an already-approved branch whose stage failed.

Observed 2026-08-16: pipeline `22041e31` (`pipeline-terminal-settlement-supersedes-mid-stage-prs`) split into three branches — `configure-pipeline-supersede-policy` (gate approved, **plan failed**), `retire-superseded-pipeline-branches` (gate awaiting), `settle-superseded-pipeline-prs` (gate awaiting). The operator wanted to replay only the configure branch's failed plan; `jarvis pipeline resume 22041e31` exited 0 but did nothing (pipeline is awaiting-approval on the two sibling gates). The only current escapes are to reject both sibling gates (terminating those branches) or approve everything — neither isolates the one branch.

## Decisions

- Add an optional branch argument: `jarvis pipeline resume <pipeline-id> [<branch-key>]` (daemon `pipeline_resume` gains an optional `branchKey`). With a branch key, resume replays only that branch's failed stage(s), scoped exactly like post-approve successor dispatch already is (per-branchKey), and ignores sibling branches' undecided gates. Rules out the current all-or-nothing whole-pipeline resume.
- Branch-scoped resume dispatches even while the pipeline's overall derived state is `awaiting-approval`, provided the *named* branch is itself not blocked on its own undecided gate — a sibling branch's awaiting gate must not veto an unrelated branch's failed-stage replay. Rules out the current `missing_context`/`claim_refused` no-op that a sibling gate triggers.
- The named branch must have a replayable failed stage past its own (already-decided) gate; if the branch is itself awaiting its own gate, resume refuses with a clear reason naming the gate (approve/reject it instead). Rules out silently doing nothing.
- Whole-pipeline `resume` (no branch key) keeps today's semantics exactly. Rules out changing the existing contract.
- Refusals name the branch key and reason on stderr and exit non-zero, matching the existing mutation-command refusal shape.

## Acceptance criteria

- [ ] `jarvis pipeline resume <id> <branch-key>` replays only the named branch's failed stage and dispatches even when a *sibling* branch sits at an undecided gate, pinned by a daemon test seeded with the `22041e31`-shaped fan-out (one approved-branch failed plan + two awaiting sibling gates).
- [ ] Sibling branches' stages and gates are untouched by a branch-scoped resume, pinned by a test.
- [ ] A branch-scoped resume on a branch still awaiting its own gate refuses with a reason naming that gate and issues no dispatch, pinned by a test.
- [ ] Whole-pipeline `jarvis pipeline resume <id>` (no branch key) is unchanged, pinned by the existing resume tests staying green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the branch-scoped `pipeline resume <id> <branch-key>` form, when to use it vs approve/reject, and that a sibling gate no longer vetoes an unrelated branch's replay.
- `v2/docs/daemon-host.md` / `v2/docs/workflow-runner.md` — the `pipeline_resume` `branchKey` parameter and its per-branch dispatch scope.
