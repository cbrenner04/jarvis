# The review actuator deterministically exceeds its wall clock and nothing escalates

## Problem

On a non-trivial implement diff the review **actuator** runs to its per-role wall clock and dies,
every time, while the other three review roles finish in well under three minutes. The run settles
`role_timeout` / `retry_later`, and the documented recovery — re-dispatch the same workflow —
reproduces the identical failure, because the cause is deterministic, not flaky.

**The bound was never chosen for review.** `review-role-invocation.ts:37` reads
`const boundMs = args.roleTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS`, and
`DEFAULT_ITERATION_TIMEOUT_MS = 600_000` is the **write loop's** iteration default
(`write-loop.ts:142`). `roleTimeoutMs` is declared on three types (`review-role-invocation.ts:29`,
`review-cycle.ts:31`, `review-debate.ts:50`) and forwarded once (`workflow-runner.ts:1971`), but
**nothing in the repo ever sets it** — no machine-config key, no CLI flag. Every review role in
every workflow therefore inherits a write-loop constant by accident, and the operator has no way to
raise it short of editing source.

The configured fallback cannot rescue it either: `claude.actuator` declared two rungs
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

**The actuator is not a slow role; it has the tightest bound.** Durations since 2026-07-20:

| role | n | median | p90 | max |
| --- | ---: | ---: | ---: | ---: |
| implement | 354 | 268s | 760s | 4741s |
| shrink | 160 | 135s | 260s | 473s |
| adversary | 86 | 93s | 166s | 294s |
| actuator | 121 | 88s | 548s | 600s |
| plan | 149 | 80s | 209s | 568s |

The actuator's median is fourth fastest of eight roles, but its max is exactly the wall and its p90
is 548s — roughly a tenth of invocations are already at the bound. Meanwhile `implement` does
comparable diff-scaled work at p90 760s and max 4741s without failing, because the write loop's
iteration budget is far larger. The bound is mis-sized against the work, not the model mis-chosen.
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
- Make the review-role bound a real, operator-settable value rather than an accidental fallback to
  the write-loop constant: add a machine-config key, resolve it where the other write-path bounds
  are resolved, and thread it into the already-declared `roleTimeoutMs`. Rules out leaving a
  plumbed-but-never-set parameter, which is why this was invisible until it failed.
- Default the review-role bound to **1_800_000 ms**, matching `DEFAULT_ITERATION_CEILING_MS` from
  the progress-extended wall work (#2121), and stop defaulting it to
  `DEFAULT_ITERATION_TIMEOUT_MS`. Rules out keeping a 600s bound whose p90 is already 548s. Turning
  review off (`--review-passes 0`) is not an acceptable standing workaround.
- Size the actuator's bound against the work it is given, or bound the diff it receives — a role
  whose input scales with diff size cannot have a fixed wall that a normal diff exceeds. The write
  step already does the same diff-scaled work at p90 760s against a far larger budget, so the
  actuator's 600s is the outlier. Pairs with `ready-intents/implement-review-bounds-diff-payload`.
- Rung order is escalation, cheap to expensive; a role whose first rung is its slowest model
  maximizes the chance of hitting the wall before any fallback is reachable. `claude.actuator` was
  ordered `opus-5 → sonnet-5` when these timeouts were observed. Rules out treating rung order as
  arbitrary.
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
- [ ] The review-role bound is resolved from machine config and reaches `review-role-invocation`
      through `roleTimeoutMs`; a test asserts a configured value is honored and that the default is
      1_800_000 ms, not `DEFAULT_ITERATION_TIMEOUT_MS`. Reverting the wiring so the parameter goes
      unset fails the test.
- [ ] No production path resolves a review-role bound from `write-loop.ts`'s
      `DEFAULT_ITERATION_TIMEOUT_MS`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — correct the `role_timeout` recovery: re-dispatch is not a fix for
  a deterministic overrun; document rung escalation and what to do when rungs are exhausted.
- `v2/docs/agent-model-config.md` — that wall-clock overrun advances the rung, alongside quota.

## Prerequisites

None.
