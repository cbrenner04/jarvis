# 2026-09-16/17 — the recovery honesty chain lands

Operator session 2026-09-16 15:00 → 2026-09-17 11:45 CDT, agent order `claude`. Cost: operator `/cost` **$261.78** (API 2h10m; 1636 lines added, 113 removed); agent telemetry **$240.55**; combined **$502.33** (sonnet-5 $181.93 / 155 inv / 917 min; opus-5 $58.62 / 128 inv / 50 min; 283 invocations, 966 min). Undercount: 10 rows have null `cost_usd`.

## Landed

**Implementation:**

- #3937 telemetry caps (hand-published after quota)
- #3941 / #3947 / #3951 — #3934 PR body: spec line + overview unattended; title refresh hand-fixed an unkillable signal guard; collapsed attribution hand-fixed a dead export after repair wandered 36 files
- #3953 markdown lint seam (review actuator `role_timeout`; review found 4 defects)
- #3956 real-spawn daemon waits (agent sandbox cannot bind sockets; 25.3s→19.6s; operator waived 1/3 target)
- #3957 resume test split (owner split-brain; old generation published)
- #3972 git fixture template (quota at actuator; 3 verdict fixes)
- #3970 stage-succeeded incident (hand-published; key-format bump)
- #3979 intent `none` normalization (unattended)
- #3988 intent landing reprompt (quota; hand-finished)
- #3977 + #3982 resume through workflow (plan claim false; agent blocker; split spec; `iteration_timeout`, 2 gate refusals, false out-of-scope; hand-fixed stale terminal cause)
- #3981 + #3987 run owner stamping (false out-of-scope; fixture; restart-recovery regression caught in audit; post-admission stranding caught in review and fixed)
- #3984 artifact-count exemptions (unattended)
- #3990 base-ref probe conclusive — root cause: probe worktree lacked `node_modules`, so every probe crashed and read as a base failure; review row stranded twice
- #3994 daemon retire-trigger logging (verifier treats `*.test-support.ts` as production)
- #3995 probe observations (hand-found production bug: pass count always 0; fixed to bun summary lines)

**Operator-owned, reviewed:** #3948 plan `--base` (review + fixes), #3954 opencode diagnostics (two reviews). #3950 removed obsolete opencode intent.

Seeds/intents/plans/archives: #3935, #3936, #3942, #3952, #3958, #3963, #3968, #3969, #3971, #3973, #3975, #3976, #3978, #3983, #3989, #3991, #3997, #3998, #3999, #4000, #4001, #4002, #3996, #3997–#4001; #4002 plan open.

Issues: closed #3595, #3464, #3934. Triaged #3974 (seeded continue-lane; ask 1 landed via #3982), #3949 (seeded).

## Decisions

- Mutation verification measured (137 reprompts / 48 of 536 rows, ~6% agent time, ~70–75% real tests) — kept as is.
- Test-speed fixes 1, 3, 4, 5 chosen; CI pool width declined.
- Failure-reporting chain held.

## What went wrong

- **Daemon outage ~05:48–06:24 CDT:** committed self-handoff successor 92099 exited silently; public socket absent until manual `jarvis daemon start`. Seeded [[daemon-survives-committed-successor-death]].
- Stage settlement failed live lanes after handoffs (twice).
- Quota exhaustion twice (~00:30 reset, ~05:30).
- False `ready_gate_out_of_scope` 3× — root-caused and fixed (#3990).

## Friction (not seeded)

- Merging a lane PR before its pipeline terminal action → publication-failure incident.
- `gh pr checks --watch` hung a turn.
- Cleanup archive worktree lacks `node_modules` (`lint:md` false red).
- Agent backgrounded the full test suite (`invalid_token`).
- Python monitor filter swallowed events.
- Command chain pushed despite lint failure (operator).
- Pipeline intent PRs never merge, so seeds linger.
- Stage stays `failed` when a lane is recovered by `run resume` or by hand.

## Priority for next session

1. [[daemon-survives-committed-successor-death]] lanes: successor watch, then foreign-owner stage settlement (intents on main)
2. [[workflow-terminal-incident-fires-once]] — marker store planned #4000; implement failed on quota before starting
3. [[mutation-verifier-skips-test-support-files]] — planned #4001; implement failed on quota
4. [[implement-continues-committed-lane]] — plan #4002 (operator amended to rebase a moved base)
5. [[plan-landing-lint-is-recoverable]]
6. [[wal-lock-holder-child-exits-silently]]
7. [[implement-can-run-integration-slice-tests]]
8. [[ready-gate-repair-out-of-diff-edits]] (3 recurrences)
