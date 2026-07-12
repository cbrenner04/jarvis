# Operators poll for run completion because Jarvis never tells them

Every operator session ends up hand-rolling shell around Jarvis to find out when a
command finished. That polling scaffolding is the tell: the harness has no way to
say "this run is done", so every operator invents one.

## Problem

Observed across the 2026-07-12 session. To drive work in parallel, an operator must
background each invocation — and then has nothing to wait on. What gets written
instead, over and over:

```sh
until grep -qE "exit reason" run.log; do sleep 30; done      # is it done yet?
tail -f run.log | grep ...                                    # did it fail?
watch 'git -C .worktree/<spec> log --oneline'                 # is it progressing?
```

None of this is a Jarvis command. It is bespoke, per-session, and wrong in
different ways each time (this session: a completion grep that also matched the word
"error" in seed prose, producing false failure alerts).

The north star is that an operator session touches **only `jarvis1` commands**.
Waiting on a run is the single most common thing an operator does, and it is the
thing Jarvis provides no command for.

Note the surfaces already disagree: v2 has `jarvis run wait <run-id>` and a daemon
that knows every run's terminal state. v1 — the shipping surface operators actually
drive — has nothing. `jarvis1 run` blocks in the foreground, which is useless the
moment you background it to run two things at once, which every real session does.

## Scope

- A first-class way to be notified when a Jarvis invocation reaches a terminal
  state, without the operator writing a loop. Shape is open; the constraint is that
  it replaces polling, not adds to it.
- Cover the states an operator actually acts on — not just success: completed,
  gate-red, blocked, quota-exhausted, iteration-timeout, agent-cascade-exhausted.
  A notifier that is silent on failure is worse than none, because silence reads as
  "still running".
- Work for a **backgrounded** invocation, since parallel operation is the normal
  case, not an edge case.
- Reach an operator who is not watching the terminal (the agent-operator case: the
  harness re-invokes on completion; the human case: an OS notification or a
  terminal bell). Both are the same need.

## Decisions

- **Publish/subscribe, not poll.** Jarvis already *knows* the terminal boundary — it
  writes `exit_reason` to `~/.jarvis/runs.jsonl` and, in v2, commits a durable run
  status and a structured log event. The information exists; there is simply no way
  to *subscribe* to it, so every consumer re-derives it by tailing and grepping.
  Publish terminal events on a bus and let consumers subscribe.
- One published event stream serves every consumer that currently reinvents this:
  the operator shell, the agent-operator harness, `jarvis run wait`, the TUI, and an
  OS notifier. Today each of those either polls or has its own bespoke path — v2's
  `run wait` and the TUI's `list` refresh are two separate answers to the same
  question, and the v1 operator has none.
- Fold into the existing invocation surface rather than adding a new subcommand
  where possible — per the north star, "fewer manual steps" is not "more commands".
  A subscribe flag on `run`/`plan`/`intent`, or a config-level notification setting,
  beats a new `jarvis1 watch`.
- Do not solve this by telling operators to run in the foreground. Parallelism is
  required (plans/intents fan out); the harness must support waiting on backgrounded
  work.
- Terminal-state coverage is the acceptance bar, not happy-path completion.

## Out of scope

- The v2 daemon's `run wait` (already exists) — though its terminal-state model is
  the obvious thing to reuse rather than reinvent.
- Live progress streaming. This is about the terminal boundary, not a TUI.

## Documentation updates

- `v1/docs/operator-runbook.md` — replace the hand-rolled
  [Background-run-and-poll pattern](../../v1/docs/operator-runbook.md#background-run-and-poll-pattern)
  section, which currently *teaches* operators to write `tail -f` / `pgrep` /
  `runs.jsonl` polling, with the supported path. That section existing at all is the
  clearest evidence of this gap.
