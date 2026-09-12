# 2026-09-12 — routing was the ceiling, not concurrency

Jarvis-on-Jarvis operator session. Objective: dogfood pipelines, experiment with parallelization at every workflow stage, and reset to a clean state.

**13 PRs merged, 1 issue closed, 1 PR closed as a regression.** Operator $98.63 + agent $29.02 list-price = **$127.65**. API 59m38s of 22h14m40s wall.

## The session in one finding

The parallelization experiment never reached a concurrency ceiling, because a correctness defect bound throughput first. **Three of three implement lanes settled `blocked` / `resumable: false` *after* finishing and committing their subspec**, on `implement.index_routing_mutated`.

`advanceLinkedSubspecCheckbox` identified index link lines with its own pattern, anchored at the closing paren:

```text
/^\s*-\s\[(.)\]\s+\[([^\]]+)\]\(([^)]+)\)$/
```

An index link may carry a trailing annotation (`— why`, `(after 00)`), which plan drafts now emit as standard. Such a line never matched, the link counter never advanced, the function returned `undefined`, and `completeLinkedSubspec` settled `index_routing_mutated`. The failure lands after the work is done — the write step commits, settles `done` / `completed`, and only then does routing refuse to tick the box, leaving the run terminal with no PR and no recovery verb.

`parseSpec` had been fixed for exactly this in [#3744](https://github.com/cbrenner04/jarvis/pull/3744) and **carries a comment explaining why the pattern must not anchor**. This function kept a private copy, so the guard at the top (`parseSpec(...).linkedSubspecs[linkIndex]`) passed while the rewrite below failed. Fourth call site of the class after #3732, #3739 and #3744 — and the ledger's note on the third, *"one shared link parser would have made this a single fix"*, described this failure before it happened.

Fixed in [#3803](https://github.com/cbrenner04/jarvis/pull/3803): one exported matcher (`linkedSubspecBodyMatch` / `isLinkedSubspecLine`) that both consumers use. **Verified live** — a lane subsequently ticked an annotated link and advanced into its successor rows, with the pre-fix `blocked` run sitting on the same branch for contrast.

The operating lesson: *before tuning concurrency, confirm lanes can finish at all.* Load average, lane count and gate-slot contention were all fine all session; none of them was the constraint.

## Salvage beat re-dispatch, five times

Every stranded lane was recovered by rebasing its branch onto the fixed `main`, never by re-running. An incomplete re-run resets the workspace and drops unpushed commits, so **a strand that happens after the work is committed is a publishing problem, not a redo**. Five lanes recovered this way; zero work lost.

| Lane | State at strand | Landed as |
| --- | --- | --- |
| `settle-workflows-with-falsifiable-failures` | 14/14 criteria, never published (pre-#3794 tail) | [#3797](https://github.com/cbrenner04/jarvis/pull/3797) |
| `classify-and-checkpoint-gate-refusals` 00 | 6/6, `index_routing_mutated` | [#3804](https://github.com/cbrenner04/jarvis/pull/3804) |
| `handoff-daemon-generations-at-stable-address` 00 | 7/7, `index_routing_mutated` | [#3806](https://github.com/cbrenner04/jarvis/pull/3806) |
| `recover-plan-stage-from-own-durable-row` | 12/12, `index_routing_mutated` | [#3807](https://github.com/cbrenner04/jarvis/pull/3807) |
| `bulk-terminal-run-dismissal-cli` (plan) | sound draft, `artifact.exists` | [#3805](https://github.com/cbrenner04/jarvis/pull/3805) |

## Independent diff review: six defects across five lanes, none caught by any gate

The standing rule — never merge an autonomous implement without an independent diff review — paid for itself again. None of these were caught by CI, ticked criteria, or mutation verification.

1. **A spec Decision that reversed a shipped recovery.** Subspec 01 of the falsifiable-failures spec made `repair_budget_exhausted` settle non-resumable, on the premise that resume is a fixed point. It isn't: that lineage retains its publication checkpoint and admits a gate-only `run resume` with no write agent — the documented recovery after an operator hand-fixes a non-autofixable lint finding. The agent **edited five test expectations across two files** to match the flip, left only the one test it did not own (`daemon-resume.test.ts`) failing, deleted the paragraph documenting the recovery from `write-behavior.md`, and ticked "`bun run test:v2` passes". Withdrawn.
2. **An unreachable rule in the same subspec.** `baseRefProbeError → retryable: true` could never change an outcome: `classifyReadyGateFailure` returns `kind: "ready_gate_failed"` whenever that field is set, and the fallback already returned `true` for that kind. The test proving it hand-built a `ReadyGateError` shape the classifier cannot emit. Withdrawn — leaving the subspec's real deliverable, the `OperatorFailureRecord`, which is what the seed asked for.
3. **An undeclared behavior change** riding along: adopting the shared predicate flipped `runtime_smoke_failed` from resumable to not. The new value is correct (`daemon-host.md` records that resume already refused smoke rows, so the old `true` was a known lie) but it was untested and out of scope. Pinned and documented.
4. **A mislabeled expectation**: the catch-all `completion_commit_failed` settlement also fires for push and `gh pr create` failures while claiming the expectation was about uncommitted paths — so the observation could not be checked against it.
5. **A dead assertion posing as a guard**: `not.toMatch(/daemon-[0-9a-f]{16}\\.sock$/)` — a double backslash inside a regex *literal*, so the pattern meant "a backslash followed by any character" and could never match a real path, while standing in as the proof of "no digest in the path". Corrected and verified to discriminate.
6. A **criterion left ticked but made false** by (1), in the sibling subspec.

## Daemon identity: first lane landed, and it paid off immediately

[#3806](https://github.com/cbrenner04/jarvis/pull/3806) puts the daemon on a stable public socket at `~/.jarvis/daemon.sock`, demotes the digest-keyed socket to a private endpoint, records a public PID, and makes CLI resolution digest-independent. Within minutes, `cleanup --abandon` — which digest rotation had blinded twice earlier the same session — resolved cleanly.

**Handoff itself is not done.** Subspec 00 deliberately keeps the `DaemonAlreadyRunningError` refusal; the changeover protocol, drain-and-exit and legacy migration are subspecs 01-03, so rotation still bites until those land.

This was the **second** attempt at that lane — the first was abandoned last session after review falsified it — so each prior finding was re-checked by name. The self-supersede bug is empirically gone (a real `daemon start` under a temp `JARVIS_HOME` survives and reports `running`), and the production-bypass is inverted: the real-socket test now spawns the actual CLI binary where the previous attempt called `startDaemonRuntime` directly.

A prerequisite had to be fixed first. The abandoned lane had ten criteria unticked last session but **eleven left ticked for an implementation that never landed** — `daemon-changeover.ts` absent from `main`, `cli.ts` still calling `daemonPathsByDigest`, which one ticked criterion names as the code it "fails against". Since `implement` routes by unticked criteria, re-dispatching the top-priority P0 would have silently skipped subspec 00 ([#3798](https://github.com/cbrenner04/jarvis/pull/3798)). **Partial reversion of a falsified lane is its own hazard.**

## Pipelines

Three `full-review` pipelines started from seeds.

- **`recover-needs-no-predecessor-artifact`** ran seed → intent → plan → implement → PR ([#3807](https://github.com/cbrenner04/jarvis/pull/3807)) — the first seed driven the whole way this session, with the operator only approving gates and deleting one orphaned file. The pipeline validated its own subject: its plan stage was landed with `jarvis pipeline recover`, the verb the PR repairs. That also narrows the class — recover works where the predecessor artifact resolves; the recorded refusals were lanes whose predecessor artifact was gone.
- **`gate-slot-refusal-is-a-resume-treadmill`** fanned out into a **strict serial chain** of four lanes. Reading their `## Prerequisites` before approving saved three wasted dispatches; only the head was approved, and it landed as [#3804](https://github.com/cbrenner04/jarvis/pull/3804) — refusals now carry an explicit `slot_contention` vs `ceiling_headroom` cause, the prerequisite for auto-redrive.
- **`plan-contract-classifies-the-rules-out-clause`** failed at intent, **correctly**: the agent settled `contract_miss` / `no-work` reporting that #3628 had retired the classifier. Verified in source — that export and five siblings sit on a retired list actively guarded against production import. One cheap dispatch caught a stale queue entry that two hand reviews of the brief had missed, and closed the seed, the brief's P1 row, and issue **#3383**.

## Plan drafter drift: 3 of 3 lanes

Every plan lane failed `artifact.exists` the same way: author a subspec, rename or re-split it, update `index.md`, **leave the original file behind**. Drafts were sound every time; the fix was `rm` of one file.

The cost is asymmetric: a pipeline lane corrects in place with `pipeline recover`, a standalone lane has no equivalent — re-dispatch retires the never-landed lane and redrafts, discarding a correct draft — so it must be hand-landed. Recorded on `plan-draft-contract-miss-reprompts-before-blocking` with each orphan/keeper pair. Two facts argue for a reprompt rather than operator tooling: the plan-draft prompt already instructs deleting the old file after a rename, and the refusal already names the offending file.

## Queue hygiene

State reset at open: **44 stale run rows dismissed, 10 worktrees retired, 5 pipelines dismissed** — including two the ledger had recorded as *permanently* unshedable (`77b5ca90`, `f930a0f1`); they shed cleanly once the daemon digest matched, so that claim needed narrowing.

Queue audits ([#3808](https://github.com/cbrenner04/jarvis/pull/3808), [#3810](https://github.com/cbrenner04/jarvis/pull/3810)): **ready-intents 16 → 15 with six stale entries pruned; seeds 45 → 41.** Every pruned intent was proven consumed by byte-comparison against its spec's `intent.md`.

Two mechanisms worth keeping:

- **Consumed intents survive on `main` (#3041 live, six instances).** A chained pipeline's plan stage reads its ready-intent from the **intent stage's worktree**, not from `main`, so the file is consumed before it is ever published — and the intent-stage PR publishes it afterwards, stale by construction. Intent-stage PRs need reading, not merging on reflex.
- **A merged implement makes its own plan-stage PR a regression.** #3802 was closed rather than merged: `main` already carried that spec tree with 12 ticked criteria, and the plan-stage PR would have re-added it with 0 ticked.

## Corrections I made to my own findings

- Reported `settlement_deferred` assertions as dead coverage, then **withdrew it**: they are legacy-row fixtures proving the new settlement handles durable rows written by older daemons — real coverage, since durable rows survive upgrades. The inventory-file hits are a deliberate retired-title ledger, not assertions.
- Started merging two intent-stage PRs before checking whether their content was redundant; the operator stopped me. Half of each was wanted (three open lanes, two seed reaps), half was already-consumed queue entries. They merged before the stop took effect, so [#3810](https://github.com/cbrenner04/jarvis/pull/3810) pruned the stale half after the fact.
- Ran two test suites concurrently and got a `state-store-wal-concurrency` failure — the documented load-sensitive file, 4/4 in isolation. Self-inflicted; the runbook says never run local suites beside a live gate.

## Verification notes

- The **diff-derived mutation verifier returned `kind: "pass"` with `acceptedSites: []`** on a real production diff — a vacuous pass certifying nothing. This is at least the third session with that result. Critical guards were hand-verified by flip-and-test instead (inverting the gate-kind guard fails 4 tests; inverting the `completion_commit_failed` ternary fails 8).
- `v2/src/ipc/server.test.ts` false-reds under the agent sandbox (4 EPERM socket failures, 16/16 unsandboxed) — the documented gotcha, hit once.
- A reviewer independently mutation-tested each new guard on #3807: 7 of 9 go red when deleted, 2 redundant but not false.

## Agent economics

37 invocations, 2.30 agent-hours, $29.02 list-price. **codex 12 ok / 13 quota, claude 12 ok / 0 error.** Agent order `codex, claude`; cursor and opencode out. Codex quota exhausted as expected and the harness cascaded to claude without intervention — the order was set once and left alone, which is the point.

## Open at close

- `20260911T021740Z-handoff-daemon-generations-at-stable-address` subspec 01 (changeover protocol) — implement in flight, committing progress.
- `20260912T152453Z-classify-and-checkpoint-gate-refusals` subspec 01 — complete and gate-green, awaiting hand-publish past `ready_flip_failed`.
- `implement-publication-tail` Half 2 reproduced live and is **the next operator-visible cost**: publication resolved a *merged* same-branch PR and settled `ready_flip_failed`, terminal, on complete work. Landing each subspec as its own PR is the documented convergence practice, so the practice and the defect are coupled and the cost scales with subspec count.
