# Bug-fix standby session — 2026-08-29/30

Operator on watch for intake issues while a concurrent session dogfooded `homestead-service` (`plan.commit: false`, agent order codex→cursor→claude throughout). Three issues intaken; two fixed end to end, one seeded and deliberately paused. All work rode seed → intent → plan → implement with admin-merge on green.

## Implementation PRs

| PR | What | Chain |
| --- | --- | --- |
| [#3112](https://github.com/cbrenner04/jarvis/pull/3112) | codex `--skip-git-repo-check` + trusted-directory refusal classifies as advancing `quota`/`authFailure` | #3106: seed #3107 → intent #3108 → plan #3110 |
| [#3113](https://github.com/cbrenner04/jarvis/pull/3113) | terminal `invocation_failure` persists bounded final-attempt stderr on `InvocationFailureDetail.message` | #3106: plan #3109 |
| [#3117](https://github.com/cbrenner04/jarvis/pull/3117) | `run list`/`wait` project that stderr as `error.message`; `run list` gains a JSON `message` column | #3106: intent AC fix #3115, hand-landed plan #3116 |
| [#3125](https://github.com/cbrenner04/jarvis/pull/3125) | shared `projectSafeId` extraction with slash-key path pins | #3119: seed #3120 → intent #3121 → plan #3123 |
| [#3128](https://github.com/cbrenner04/jarvis/pull/3128) | chained-stage matcher resolves git-disabled roots (`intent-work/`, `specs/`) to the registered project | #3119: plan #3127 |

Issues closed: [#3106](https://github.com/cbrenner04/jarvis/issues/3106) (root cause was the trusted-directory refusal at 62ms, not quota misclassification — quota patterns already matched the live message), [#3119](https://github.com/cbrenner04/jarvis/issues/3119). Open, seeded, deliberately paused on operator instruction: [#3122](https://github.com/cbrenner04/jarvis/issues/3122) (seed #3124 `implement-admits-externally-landed-specs`).

Support PRs: seeds #3114 (plan-draft contract-miss reprompt — held pending the guidance split), #3126 (`all-spec-documents-external-capable`, operator ask; history research: external-only was never the v2 default — the #120 no-artifacts principle covered config/worktrees, the external home has been opt-in since #63/#64); brief update #3129; archival #3118 and this PR.

## Costs

Agent-side (telemetry, project `jarvis`, 20:30Z→00:20Z): **$26.62** across 102 role invocations, 42 of them quota advances — codex and cursor quota churned all night; claude (opus/sonnet) carried most plan/review roles. Per-branch: codex-flag chain $10.54, stderr-persistence $5.21, stderr-projection $6.18, safeId $2.73, matcher $1.97. Operator `/cost`: pending (CSV rows follow when provided).

## Findings and friction

- **Plan-draft multi-surface AC `contract_miss` ×3** (runs `cd88e077`, `aeb4040e`, `09addc15`): twice from drafter embellishment, once mirrored from the intent's own AC. Fixes: intent AC single-surfaced (#3115), one hand-landed plan (#3116), seed #3114 (held — the guidance-split prompt work may fix the miss rate at the source).
- **Implement publication dispatches late**: the third run row and its PR appear minutes after every sibling reads `completed`/`not-live` — waiters must require settlement *and* PR evidence, or they exit in the gap (bit me twice; runbook already warns).
- **All four standalone implements auto-published cleanly** — counter-evidence for seed `implement-completes-without-publishing` (#3088); verify-or-reap.
- **Descendant-gate refusal after mid-chain merges**: a retained plan worktree from a blocked attempt refuses re-runs once main moves; `jarvis cleanup --yes --abandon <branch>` cleared it scripted, no TTY needed.
- **Operator query bugs cost two waiter arms**: escaped-quote awk in a background shell, and filtering on `live` when the finalization tail is `in-progress`/`not-live`. Both mine; both fixed in later waiters.
- **codex `exec` empty plain output**: `gh issue view` without `--json` printed nothing in this environment; `--json` worked throughout.

## Left open

- #3122 chain (external-spec implement) and #3126 (all-external) — sequenced behind [[pipeline-dispatch-shares-cli-front-door]] per the brief's 2026-08-30 notes (#3129).
- Brief P0/P1 implements already specced on `main`: architecture-doc, atomic-terminal-store, retire-checkpoint-log-events (daemon-bounce prerequisite satisfied).
- `20260829T154502Z-execution-uses-lossless-git-status` worktree holds the prior session's partial consumer-02 work (dirty; cleanup skips it; not touched).
