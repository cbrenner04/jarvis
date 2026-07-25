# The review actuator deterministically exceeds its wall clock and nothing escalates

## Problem

On a non-trivial implement diff the review **actuator** runs to its per-role wall clock and dies,
every time, while the other three review roles finish in well under three minutes. The run settles
`role_timeout` / `retry_later`, and the documented recovery — re-dispatch the same workflow —
reproduces the identical failure, because the cause is deterministic, not flaky.

The configured fallback cannot rescue it: `claude.actuator` already declares two rungs
(`claude-opus-5` → `claude-sonnet-5`), but the agent order advances **on quota only**
(`AGENTS.md`), so a wall-clock overrun never reaches the second rung. The actuator gets one shot at
the model that cannot finish in time.

Effect: review is unusable on any diff large enough to need it, and the operator's only exit is
`--review-passes 0`.

## Evidence

2026-07-25, spec `20260725T011745Z-gate-timeout-is-not-a-red-gate`, two consecutive dispatches
(telemetry, `branch: 20260725T011745Z-*`):

```text
01:41:06 implement-review adversary   claude claude-opus-5 dur=131462 exit=ok
01:42:32 implement-review advocate    claude claude-opus-5 dur=85531  exit=ok
01:43:05 implement-review adjudicator claude claude-opus-5 dur=33384  exit=ok
01:53:06 implement-review actuator    claude claude-opus-5 dur=600131 exit=error exit_code:-1

02:15:09 implement-review adversary   claude claude-opus-5 dur=135022 exit=ok
02:16:34 implement-review advocate    claude claude-opus-5 dur=84553  exit=ok
02:17:05 implement-review adjudicator claude claude-opus-5 dur=30440  exit=ok
02:27:05 implement-review actuator    claude claude-opus-5 dur=600123 exit=error exit_code:-1
```

Both actuator invocations land within 8 ms of the same 600_000 ms bound — the wall, not variance.
Each dispatch also re-ran a ~10-minute write step and a ~8-minute shrink before reaching the
actuator, so each reproduction cost ~30 minutes. The write step's completion commit survived both
times; the actuator's partial edits were left uncommitted in the worktree.

## Decisions

- A role that exceeds its wall clock must escalate to the next configured rung rather than settling
  the run. Rules out today's quota-only advancement, which makes a declared second rung
  unreachable for the failure mode most likely to need it.
- Re-dispatch must not be the documented recovery for a deterministic overrun: when a role times out
  and a lower rung exists, the retry uses that rung; when none exists, the failure says so instead
  of advertising `retry_later`. Rules out a recovery path that reproduces the failure at full cost.
- The actuator must not restart the whole workflow to be retried. Its input is the adjudicated
  verdict, which is already persisted — re-running the write and shrink steps to reach it is pure
  waste. Rules out re-dispatch as the only actuator retry.
- Size the actuator's bound against the work it is given, or bound the diff it receives — a role
  whose input scales with diff size cannot have a fixed wall that a normal diff exceeds. Pairs with
  `ready-intents/implement-review-bounds-diff-payload`.
- Out of scope: whether opus-5 is the right actuator model, and the review prompt's content.

## Acceptance criteria

- [ ] A role invocation that exceeds its wall clock with a further rung configured retries on that
      rung instead of settling the run; it fails against the pre-fix code, which settles
      `role_timeout`.
- [ ] A role that exhausts every rung settles with an error naming the exhausted rungs and does
      **not** report `nextAction: "retry_later"`; inverting the guard fails the test.
- [ ] Retrying a timed-out actuator reuses the persisted adjudicated verdict and does not re-invoke
      the write or shrink steps; a test asserts neither is invoked.
- [ ] A role that completes inside its bound is unaffected and consumes no extra rung.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — correct the `role_timeout` recovery: re-dispatch is not a fix for
  a deterministic overrun; document rung escalation and what to do when rungs are exhausted.
- `v2/docs/agent-model-config.md` — that wall-clock overrun advances the rung, alongside quota.

## Prerequisites

None.
