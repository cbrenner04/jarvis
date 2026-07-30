---
name: out-of-scope-gate-classification-strands-caused-failures
---

# Out-of-scope gate classification strands failures the run caused

## Problem

`ready_gate_out_of_scope` (shipped #2313) classifies a red gate as out of scope when the failing
paths are not in the run's diff. But a run routinely breaks a test in a file it never edited — that
is what changing a public shape does — and the classifier calls those failures out of scope, refuses
repair, and settles `resumable: true` over a condition that no resume can change. The run is
permanently stranded: each `jarvis run resume` re-runs the gate, re-classifies, and re-settles.

Observed 2026-07-30 on `20260730T084815Z-list-row-step-honesty` (PR #2334, carried over). Three
resumes, all identical:

```text
loopOutcomeKind: "ready_gate_out_of_scope"
readyGateOutsidePaths: ["v2/src/daemon/daemon.sandbox-unrunnable.test.ts"]
iterationsConsumed: 0
```

That file passes on `main` and fails in the run's own worktree — the run's added list-row fields
changed the response frame the test snapshots. The failure is squarely the run's, and the fix is a
one-line test update the fence now forbids.

## Decisions

- Scope is decided by whether the failure reproduces on the run's base ref, not by whether the
  failing path is in the run's diff: run the failing scope at `--base`, and classify out of scope
  only when it fails there too — rules out path membership as the sole signal, which is what strands
  caused failures.
- A failure that passes on base and fails in the worktree is **in scope**: repair proceeds and the
  failing file joins the repair allowset for that gate only — rules out both refusing repair and
  widening the fence generally.
- The base-ref probe is scoped to the failing files the gate already reports, not the full suite —
  rules out doubling gate wall time.
- A probe that cannot run (unresolvable base ref, probe error) fails toward **in scope** so repair
  is attempted rather than stranding the run — rules out fail-closed behavior whose only outcome is
  an unrecoverable row.
- An out-of-scope settlement stays `failed` and stops advertising `resumable: true` unless a resume
  could plausibly change the outcome — rules out the current row that invites an infinite resume
  loop.

## Acceptance criteria

- [ ] A pre-fix-failing regression drives a red gate whose failing file is outside the run diff but
      passes on the base ref: the run classifies it in scope, admits repair, and adds only that file
      to the repair allowset for that gate.
- [ ] A red gate whose failing file fails on the base ref too still settles `ready_gate_out_of_scope`
      with that path named, and existing #2313 regressions stay green.
- [ ] A base-ref probe failure classifies in scope; a regression asserts repair is attempted and the
      probe error is reported.
- [ ] An out-of-scope settlement reports `resumable` consistently with what a resume can change;
      a regression asserts a resume over an unchanged out-of-scope condition is refused by name
      rather than re-settling identically.
- [ ] Inverting the base-ref comparison, the allowset addition, or the probe-failure default turns
      its corresponding regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — out of scope means "fails on base too", and an
  out-of-scope row is not fixed by resume.
- `v2/docs/write-behavior.md` — base-ref reproduction probe and the per-gate allowset addition.
