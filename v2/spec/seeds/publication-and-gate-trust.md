# A v2 run's terminal status is not evidence of anything

Four observed defects, one root shape: **v2 asserts a terminal status without the evidence that
would substantiate it.** `completed` does not imply a green gate, does not imply a PR exists, and a
failed flip does not imply the run ever settles. The one channel that could tell the operator what
went wrong labels every failure "transient network error".

This is the consolidation of four seeds (`v2-run-reports-completed-over-a-red-gate`,
`publish-failure-is-always-a-transient-network-error`,
`failed-ready-flip-strands-the-run-and-hangs-the-cli`, `completed-run-publishes-no-pr-and-no-error`),
deleted in this PR. They share one seam — `write-loop.ts` / `workflow-runner.ts` /
`completion-publisher.ts` / `ready-finalize.ts` — and the last attempt to work them as parallel
siblings staled on #1620's rename. Plan as one unit; run the subspecs serially.

This is the run-quality tax: it is why every implement run today needs a human finisher.

## Problem

All four observed 2026-07-14 on `main`, all with real agent work already committed.

**1. `completed` over a red gate.** Spec `20260714T145402Z-resume-stopped-write-run-from-snapshot`,
runs `31b49a89`/`154ef308`, PR #1575. Operator-facing result:

```json
{"runStatus":"completed","loopOutcomeKind":"complete","iterationsConsumed":5,"resumable":false}
```

The publication run's log ends `loop_finished complete` / `loop_finished ready_finalize_failed`, and
the gate is genuinely red at the pushed commit `cfa6fc1a` on a clean tree (two formatter violations,
two `Excessive complexity` errors in `daemon.ts`). The operator found out by hand-gating.

**`ready_gate_repair` has never been emitted — not once, in any run:**

```sh
$ grep -c ready_gate_repair ~/.jarvis/state/logs.jsonl ~/.jarvis/daemon.log
logs.jsonl:0
daemon.log:0
```

`red-gate-feeds-back-to-the-agent` (#1560) shipped a bounded 3-attempt repair loop and merged
unverified. This run is the first red gate since and it still did not fire — all four biome errors
were exactly the mechanical class it was built for (`bun run fix` cleared the formatter ones). The
repair loop is dead code in practice. Two candidate mechanisms, and the spec must determine which:
the gate ran red and settled `ready_finalize_failed` without routing through repair (if a red *gate*
is classified as a *flip* failure the loop can never arm), or the gate never ran in-run at all.

**2. Every publication failure is a "transient network error".**
`v2/src/execution/completion-publisher.ts:188` and `v2/src/execution/ready-finalize.ts:75` both retry
on **any** thrown error and print the same line:

```text
gh pr ready: transient network error; retrying (attempt 2/3)
```

Neither inspects the error. The only special case is a non-fast-forward push. Auth failure, missing
PR, bad branch name, rate limit, repo permission error — all retried three times as if a network
blip, then thrown with the operator having been told, three times, something that may be false.
Observed: two of twelve `intent-reviewed` runs went `failed`/`landing_failed` while
`~/.jarvis/telemetry.jsonl` shows every agent invocation for those runs at `exit_kind: ok`. The work
was done; the landing dropped it, and **what actually failed is not recoverable from any log the
harness wrote.** Running the same `gh pr ready <branch>` by hand from the run's own worktree
succeeds immediately — not the network, not the worktree.

**3. A failed ready-flip strands the run and hangs the CLI forever.** Run `83d50cb3`
(`intent/daemon-restart-kills-in-flight-runs`). The write loop finished cleanly, the ready-intents
were written, draft PR #1569 was published. `run list` still showed:

```text
83d50cb3  jarvis  intent/daemon-restart-kills-in-flight-runs  in-progress  not-live  -  -  -  -
```

`in-progress` with nothing live. The `cli.ts run workflow intent` process was still alive and had to
be `pkill`ed; that left the claim held and the next `intent` invocation was refused
`worktree_claimed: … resume the recorded invocation` — advising a resume that cannot work. The only
way out is a daemon bounce, which kills every other in-flight run
(`daemon-restart-kills-in-flight-runs`), whose documented recovery is `jarvis run resume`, which is
itself broken (`resume-of-a-killed-run-has-no-bindings`). The recovery path is circular. The only
trace was two `transient network error` lines — defect 2 is what turned a recoverable failure into
an undiagnosable one.

**4. `completed`, branch pushed, no PR, no error.** Spec
`20260714T023458Z-quota-detection-matches-typographic-apostrophe`, runs `d39b7c74` and `39a40920`,
same branch. Worktree HEAD `3cbfc2c6 jarvis: complete run` with a real diff; `git ls-remote origin`
has the branch at that exact sha; `run list` shows two `completed` rows with `-` in the error column;
`gh pr list` shows **no PR**. Nothing anywhere says a PR was ever attempted. Two sibling runs in the
same batch (#1539, #1540) published normally — nondeterministic, not config or auth. The operator
only noticed because the PR count didn't match the run count.

## Scope

Four behaviors, serial, in this order (each later one depends on the vocabulary the earlier one
establishes):

1. **Gate-red and flip-failed are distinct outcomes.** Separate them in the run log and in
   `run list` before fixing either — today both land as `ready_finalize_failed`, so they are
   indistinguishable from the outside and cannot be debugged through.
2. **Publication failures carry their real cause.** Evidence-aware classification and notices shared
   by both call sites.
3. **A failed ready-flip terminal-settles the run**, releases the worktree claim, and `run workflow`
   returns.
4. **`completed` requires its evidence:** a green gate (routed through the repair loop first), and,
   on a pushed branch, a PR whose number/URL is on the terminal record.

## Decisions

- **`completed` means the gate was green.** Rules out any terminal-success path that tolerates a red
  gate, including "the PR is published, the operator will notice."
- **A red gate routes to the repair loop before any terminal settle**, and emits `ready_gate_repair`
  when it does. **Assert on the repair loop's evidence (the event), not on the run reaching a
  status** — #1560's tests pass while the loop never runs, the same blind spot as
  `tui-tests-bypass-the-render-path` and the silent-no-op review step.
- **A workflow run that pushes a branch does not report `completed` until its PR exists.** A
  publication that produces no PR is a run failure with a named error, not a silent success. The
  terminal record carries the PR number/URL, so `completed` is falsifiable from `run list` alone
  without calling `gh`. Reproduce before fixing: `findOrCreatePr`
  (`v2/src/execution/completion-publisher.ts:194`) lists open PRs for the head branch and creates one
  only when none matches `baseRef` — a stale or empty `pr list` result, or a `baseRef` mismatch,
  silently yields "found it, nothing to do". A candidate, not the diagnosis.
- **Terminal-settle on finalize failure rather than retrying forever.** The work is committed and the
  PR exists; the run is done, the *flip* failed. Rules out treating a finalize failure as a still-
  running run. The remediation names the PR and the actual error, not `resume`. A claim held by a run
  that is no longer live is reclaimable without bouncing the daemon.
- **One evidence-aware retry policy** shared by completion publish (push, PR ensure, body refresh)
  and the ready flip; no second classifier or divergent notice format. A retry notice names the
  actual error — message and exit code, with bounded separately-labeled stdout/stderr tails,
  normalized once for both classification and notices — never replaced with a guess at the cause.
- **Retry only positively classified transient transport failures; unknown is permanent**
  (fast-fail), alongside auth/permission/not-found/invalid-input. Keep three total attempts with flat
  1000 ms backoff; exhausted retries rethrow the original failure. Preserve the dedicated
  non-fast-forward divergence error; evaluate `already ready` / `not a draft` success guards before
  classification.
- **Ready-gate (test) failures stay outside publication retry classification** — the `ReadyGateError`
  repair path is a separate concern from transport retry.
- Both call sites (`completion-publisher`, `ready-finalize`) get the same treatment; do not fix one.
- **A failed landing names what failed.** `landing_failed` / `invocation_failure` on a run whose
  agent invocations all exited `ok` must carry the publication step's real error.
- Regression coverage asserts a red gate cannot produce `runStatus: "completed"` — the coverage gap
  that let #1560 merge unexercised.

## Prerequisites

- None.

## Out of scope

- The `run workflow` exit code (`run-workflow-exits-zero-on-failed-run`).
- Whether the review step logs at all (`review-step-emits-log-events`).
- Draft-vs-ready PR state (`v2-workflow-pr-stays-draft-and-untitled`).
- Making the biome rules themselves easier to satisfy.
- Why the daemon's `gh pr ready` failed while the operator's succeeded — unknowable until the error
  is preserved. That is the point.
- The claim/ownership model itself.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — what `completed` guarantees about the gate and about
  publication. Remove the "#1560 is not verified end-to-end" caveat only when `ready_gate_repair` is
  actually observed; until then state that a `completed` v2 run does **not** imply a green gate.
- `v2/docs/operator-runbook.md` § Recovery — recovery for a failed ready-flip; remove the advice to
  resume; drop the "check `~/.jarvis/daemon.log`" advice for publication failures once the run log
  carries the cause.
- `v2/docs/operator-runbook.md` § Known gotchas — delete the "Every implement run has committed a red
  gate" bullet when the repair loop is observed firing.
- `v2/docs/workflow-runner.md` — gate-red vs flip-failed outcomes, and repair-loop ordering.
- `v2/docs/daemon-host.md` — terminal settle on finalize failure, and claim release.
- `v2/docs/write-behavior.md` — the completion boundary's publication contract.
