---
name: run-admission-stamps-its-owner
---

# Every admission that makes a run live stamps the admitting daemon as owner

## Problem

`runs.owner_identity` is written only when the row is inserted (`v2/src/persistence/state-store.ts:1850`); nothing updates it when a later daemon generation makes the run live again (`jarvis run resume`, automatic recovery). Pipelines already re-claim ownership (`state-store.ts:2231-2238`); runs do not. So a run dispatched by daemon A, idle across a handoff to B, and resumed on B still names A as owner. When B later hands off to C, C's startup reconciliation sees a dead owner, treats B's live draining work as a daemon-death orphan, settles it `killed` (`daemon_restart`) and auto-resumes it into B's worktree lock — the draining-ownership protection (#3893) checks the owner the row names, and the row names the wrong one.

## Evidence

2026-09-17, run `64b09d5d` (lane `workflow-runner-resume-test-split`, pipeline `39d79f62`): admitted under daemon 96109 (`owner_identity = 96109:1789610599392`); paused `invalid_token`; #3953's merge handed off to 5930; `jarvis run resume` at 02:33:43 started an attempt on 5930; #3956's merge handed off to 91733, which at 02:34:10 logged `run_reconciled killed daemon_restart`, re-resumed, and settled `failed` / `invocation_error` / non-resumable on `worktree is in use by process 5930`. The pipeline went terminal `interrupted`. Meanwhile 5930 kept running a Claude agent in the worktree, later committed, published PR #3957 and overwrote the row to `completed` — about ten minutes of a durable row contradicting live work.

## Decisions

- Resume admission and automatic recovery stamp the admitting daemon's identity on the run row in the same transaction that makes it non-terminal. Rules out ownership fixed at first insert.
- A successor's reconciliation keeps treating the named owner as authoritative; this seed fixes what is named, not how it is read.
- A stamp never overwrites a live different owner: admission refuses (existing claim refusal) rather than steal. Rules out two daemons each believing they own a run.
- A settlement from a daemon that is no longer the row's owner does not overwrite a terminal status another generation wrote (the 5930 overwrite above), or, if the run genuinely completed, records both transitions in the run log. Decide at intent time; either is acceptable, silent overwrite is not.

## Acceptance criteria

- [ ] A daemon test drives dispatch on generation A, handoff to B with the run paused, `run resume` on B, then handoff to C, and asserts C leaves the run live and owned by B (no `run_reconciled`); it fails against the current insert-only stamp.
- [ ] A test asserts automatic recovery stamps the recovering daemon's identity.
- [ ] A test asserts resume admission refuses when a different live daemon owns the row, leaving `owner_identity` unchanged.
- [ ] A test pins the chosen behavior for a stale-owner settlement landing on a row another generation already settled.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Daemon retirement on supersession — ownership stamping on resume/recovery.
- `v2/docs/operator-runbook.md` — remove any gotcha this closes.
