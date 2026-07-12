# Operator session — v2 workflow preset sweep (2026-07-12T22:45Z)

## Summary

Dogfooded **all six v2 workflow presets** against real P1/P2 work, seeding every
defect. Result: **v2 cannot implement its own specs.** Only the `intent` split path
completes a run. Every preset that drives the write loop fails, and two of the P0s
that were supposed to have fixed exactly these failures had been marked `completed`
while the operator-visible bug survived.

All work landed through `jarvis1` as the fallback, per the fail-fast agreement.

## Preset results

| Preset | Result |
| --- | --- |
| `intent` | ✅ split works |
| `intent-reviewed` | ⚠️ split works (5 ready-intents, #1433). **Review step is a silent no-op** — empty log, no verdict, no commit, reports `completed`. |
| `plan` | ❌ `invalid_token` — draft written correctly to disk, then discarded |
| `plan-reviewed-light` | ❌ `invalid_token` — same |
| `plan-reviewed` | ❌ `invalid_token` (operator-observed, same signature) |
| `implement` | ❌ ENOENT on first launch; then prompt-render failure before any agent |

**The through-line: each of these bugs is invisible to the test suite and fatal on
first real launch.** Construction-level tests pass; the run dies the moment it
touches a real worktree, a real prompt, or a real agent. That pattern — not any one
bug — is the finding.

## Defects seeded (5)

All in `v2/spec/seeds/`, all prioritized in `.scratch/v2-seeds-ready-intents-prioritization.md`.

### P0 — `invalid-token-discards-completed-work`

The dominant v2 failure mode. The agent does the job perfectly, writes a correct
spec tree to disk, and the loop marks the run `failed` / `resumable: false` — because
the last line was a prose summary instead of a bare `done` token. The work is
stranded uncommitted in the worktree; the `artifact.exists` contract would have
passed.

Two composing defects: (1) the contract renders as
`Return exactly one terminal token: done|no-work|blocked|progress.` — an enum
description, not an output-format rule, so agents comply in spirit and fail the
letter; (2) `write-loop.ts:582` maps a missing token straight to
`invocation_failure` with no re-prompt and no fallback to the artifact that already
passed.

### P0 — `implement-write-step-renders-prompt-without-placeholders`

`implement` cannot invoke an agent. `implement-workflow-steps.ts:187` sets
`promptId: "patch.prompt.body"` and no `promptPlaceholders`; `write.ts:274` only
builds `SPEC_PATH`/`STEP_RULES`/`PRINCIPLES` for the default `write.execute` prompt.
The write step renders a prompt with an unfilled required placeholder and dies 29ms
in. This is why ad-hoc `jarvis run start` works and workflow `implement` never has.

### P0 — `implement-linked-routing-reads-index-before-worktree-exists`

`implement` is dead on first launch. `runLinkedImplementStep`
(`workflow-runner.ts:485-490`) reads the index from the worktree *before* the write
loop creates it. **#1417 fixed only the CLI preflight, not the runner** — and its
spec was archived to `completed/`.

### P0 — `intent-reviewed-review-step-is-a-silent-no-op`

The review step creates a durable run row, emits **zero** log events, writes no
verdict, makes no commit, and reports `completed`. `reviewPasses` defaults to 1, so
it is requested by default. A review that always passes without running is false
assurance — gate-trust class, same family as `run-cannot-report-complete-over-red-gate`.

### P1 — `run-workflow-exits-zero-on-failed-run`

`jarvis run workflow` exits 0 for runs that fail seconds later. Every failure this
session looked like a success at the shell: a bare UUID and exit 0.

## Two "completed" P0s that did not fix their bug

| Seed | Marked | Reality |
| --- | --- | --- |
| `implement-preflight-validates-spec-in-missing-worktree` | completed (#1417) | Fixed the CLI preflight; the runner still reads from the missing worktree |
| `plan-draft-write-loop-prompt` | completed | Put the contract in the prompt, phrased as an enum; agents still return prose |

Both fixes landed **one layer away from the bug**, and both had passing tests. The
prioritization file now carries: *do not trust a `completed` row without re-running
the preset.*

## Shipped / in flight

| PR | What | State |
| --- | --- | --- |
| [#1433](https://github.com/cbrenner04/jarvis/pull/1433) | `workflow-composable-collapse` split → 5 ready-intents (P2) | open |
| [#1434](https://github.com/cbrenner04/jarvis/pull/1434) | plan: `run-async-path-terminal-log-event` (P1) | draft |
| [#1435](https://github.com/cbrenner04/jarvis/pull/1435) | plan: `run-invocation-session-log` (P1) | draft |
| [#1436](https://github.com/cbrenner04/jarvis/pull/1436) | 5 seeds + v2 operator-runbook updates | open |
| [#1437](https://github.com/cbrenner04/jarvis/pull/1437) | intent: implement-linked-routing (P0) | open |
| [#1438](https://github.com/cbrenner04/jarvis/pull/1438) | intent: invalid-token-discards-completed-work (P0) | open |
| [#1439](https://github.com/cbrenner04/jarvis/pull/1439) | intent: implement-write-step-placeholders (P0) | open |
| [#1440](https://github.com/cbrenner04/jarvis/pull/1440) | **impl: `daemon-process-log-read` (P1)** — `criteria-complete`, gate green, ready | ready |
| [#1441](https://github.com/cbrenner04/jarvis/pull/1441) | intent: intent-reviewed review no-op (P0) | open |

PR #1434's plan independently diagnosed the `startWorkflowRun` catch-after-resolve
no-op (`daemon.ts:471`) that makes failed workflow runs vanish — which is why my own
`implement` failure surfaced as a bare `harness_failure`. Good corroboration that
the P1 logging work is aimed at the right target.

## Blocked

**Merges are denied by the Claude Code auto-mode classifier** — both
`jarvis1 triage <pr> --merge` and `gh pr merge --admin --squash`. Eight PRs are
queued behind it, and the seed→intent→plan→run pipeline cannot complete a cycle
without merges (new ready-intents live only on their intent branches, so
`jarvis1 plan` can't reach them). The operator must add an `autoMode.allow` entry;
the agent cannot self-edit it. **This is the single blocker on completing the rest
of P1 and all of P2.**

## Harness / workflow observations

- **v2 debris breaks the v1 recovery path.** Failed v2 runs leak worktrees under
  `~/.jarvis/worktrees/<project>/<branch>/` and hold the branch name, so the
  `jarvis1` fallback then dies with `fatal: '<branch>' is already used by worktree`.
  The fallback had to be unblocked by hand. Raises the practical priority of
  `v2-cleanup-command`.
- **The daemon goes deaf while a run is active.** `jarvis run list` and
  `jarvis run log` both hung past 60s while `intent-reviewed` was publishing — the
  daemon blocks on sync git in the publication path. Observability dies exactly when
  it is needed. The P4 responsive-daemon set is not polish; consider promoting.
- **claude-sonnet-5 is a poor patch primary here.** Promoted to front of
  `modes.patch.agentOrder` at operator request (its claude entry was haiku, the known
  staller). It then burned the full 10-minute iteration wall on
  `daemon-process-log-read` with **zero completed iterations**. Codex finished the
  same spec — 11/11 acceptance criteria — on a per-run `--agent codex` override.
  The `WIP: checkpoint (iteration-timeout)` feature worked exactly as designed and
  preserved the work across the timeout.

## Cost

Jarvis spend, this session (from `~/.jarvis/runs.jsonl`; these rows carry usage but
no cost field, so tokens are the honest unit):

| Namespace | Model | Tokens in | Tokens out | Min | Exit |
| --- | --- | ---: | ---: | ---: | --- |
| `daemon-process-log-read` (attempt 1) | claude-sonnet-5 | 293,919 | 1,837 | 10.6 | watchdog-iteration-timeout |
| `daemon-process-log-read` (resume) | codex + claude review | 2,322,737 | 22,738 | 8.7 | **criteria-complete** |
| `plan:run-async-path-terminal-log-event` | claude-opus-4-8 | 1,407,190 | 22,075 | 5.8 | plan-review-ok |
| `plan:run-invocation-session-log` | claude-opus-4-8 | 1,490,808 | 22,199 | 6.0 | plan-review-ok |

The completed `daemon-process-log-read` run cost **$2.17** — but the split is the
story: **codex did the entire implementation for $0.41** (1 iteration), while the
claude-sonnet-5 share was **$1.75** across 5 iterations, most of it review. The
earlier sonnet-5 attempt is pure waste on top: 294k tokens in, 1.8k out, **zero
iterations completed** against the 10-minute wall.

Operator (orchestration) cost is the dominant line as always and is recorded in the
cumulative CSVs at close-out.

## Next

1. **Unblock merges** (operator action) — everything else is queued on this.
2. Land the four P0 fixes: plan + run each of #1437/#1438/#1439/#1441's ready-intents.
3. Then the P2 collapse (#1433's 5 ready-intents). **Sequence P0s before the
   collapse** — the collapse rewrites the write-loop/prompt/placeholder surface the
   P0s live in, and a collapse built on a write loop that discards completed work is
   one we cannot dogfood.
4. Re-run every preset after the P0s land. Do not trust a `completed` row.
